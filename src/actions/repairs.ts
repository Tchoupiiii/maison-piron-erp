"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { sendEmail, notifyAdmin } from "@/lib/email/resend";
import { repairReadyEmail, repairReceivedEmail } from "@/lib/email/templates";
import { PERMISSIONS } from "@/lib/permissions";
import { REPAIR_COLUMNS } from "@/lib/constants";
import { actionError, type ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type RepairStatus = Database["public"]["Enums"]["repair_status"];

const createTicketSchema = z.object({
  customerId: z.string().uuid("Client invalide"),
  productId: z.string().uuid().nullish(),
  description: z.string().trim().min(5, "Décrivez l'intervention"),
  deadline: z.string().date().nullish(),
  estimatedPrice: z.number().nonnegative().nullish(),
});

function statusLabel(status: RepairStatus): string {
  return REPAIR_COLUMNS.find((c) => c.key === status)?.label ?? status;
}

export async function createRepairTicket(
  input: z.input<typeof createTicketSchema>,
): Promise<ActionResult<{ id: string; ref: string }>> {
  const parsed = createTicketSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Formulaire incomplet",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.atelierCreer);
    const { supabase, userId } = session;
    const d = parsed.data;

    const { data: ticket, error } = await supabase
      .from("repair_tickets")
      .insert({
        customer_id: d.customerId,
        product_id: d.productId ?? null,
        description: d.description,
        deadline: d.deadline ?? null,
        estimated_price: d.estimatedPrice ?? null,
      })
      .select("id, ref, description, deadline, estimated_price")
      .single();

    if (error) return { ok: false, error: error.message };

    await supabase.from("repair_status_history").insert({
      repair_ticket_id: ticket.id,
      from_status: null,
      to_status: "check_in",
      changed_by: userId,
    });

    const { data: customer } = await supabase
      .from("customers")
      .select("full_name, email, is_anonymized")
      .eq("id", d.customerId)
      .single();

    await logActivity(session, {
      action: "ticket_cree",
      summary: `Prise en charge ${ticket.ref} pour ${customer?.full_name ?? "un client"}`,
      entityType: "repair_ticket",
      entityId: ticket.id,
      entityLabel: ticket.ref,
      changes: { apres: { description: d.description, echeance: d.deadline ?? null } },
    });

    if (customer?.email && !customer.is_anonymized) {
      const mail = repairReceivedEmail({
        customerName: customer.full_name ?? "",
        ref: ticket.ref,
        description: ticket.description,
        deadline: ticket.deadline,
        estimatedPrice: ticket.estimated_price,
      });
      // le ticket existe : un e-mail non délivré ne doit pas annuler la prise en charge
      try {
        await sendEmail({ to: customer.email, ...mail });
      } catch {
        await notifyAdmin(
          `Confirmation de réception non envoyée · ${ticket.ref}`,
          `<p>Le client n'a pas reçu l'accusé de réception du ticket ${ticket.ref}.</p>`,
        );
      }
    }

    revalidatePath("/atelier");
    return { ok: true, data: { id: ticket.id, ref: ticket.ref } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

const updateStatusSchema = z.object({
  ticketId: z.string().uuid(),
  newStatus: z.enum(["check_in", "at_bench", "ready", "delivered"]),
});

/**
 * Le changement de statut passe par `set_repair_status` : la base écrit
 * elle-même la ligne d'historique et vérifie la permission, ce qui empêche de
 * faire avancer un ticket par un appel direct à PostgREST.
 */
export async function updateRepairStatus(
  ticketId: string,
  newStatus: RepairStatus,
): Promise<ActionResult<{ status: RepairStatus }>> {
  const parsed = updateStatusSchema.safeParse({ ticketId, newStatus });
  if (!parsed.success) return { ok: false, error: "Statut invalide" };

  try {
    const session = await requirePermission(PERMISSIONS.atelierStatut);

    const { data, error } = await session.supabase.rpc("set_repair_status", {
      ticket_id_param: ticketId,
      status_param: newStatus,
    });

    if (error) return { ok: false, error: error.message };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: "Ticket introuvable" };

    await logActivity(session, {
      action: "ticket_statut",
      summary: `${row.ticket_ref} : ${statusLabel(row.previous_status)} → ${statusLabel(newStatus)}`,
      entityType: "repair_ticket",
      entityId: ticketId,
      entityLabel: row.ticket_ref,
      changes: { avant: { statut: row.previous_status }, apres: { statut: newStatus } },
    });

    if (newStatus === "ready" && row.customer_email) {
      const mail = repairReadyEmail({
        customerName: row.customer_name ?? "",
        ref: row.ticket_ref,
        description: "",
      });
      try {
        await sendEmail({ to: row.customer_email, ...mail });
      } catch {
        await notifyAdmin(
          `Avis « bijou prêt » non envoyé · ${row.ticket_ref}`,
          `<p>Prévenir ${row.customer_name ?? "le client"} par téléphone : le ticket ${row.ticket_ref} est prêt.</p>`,
        );
      }
    }

    revalidatePath("/atelier");
    revalidatePath("/dashboard");
    return { ok: true, data: { status: newStatus } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function uploadRepairPhoto(
  ticketId: string,
  phase: "avant" | "apres",
  file: File,
): Promise<ActionResult<{ path: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.atelierCreer);

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    if (!["jpg", "jpeg", "png", "webp"].includes(extension)) {
      return { ok: false, error: "Format d'image non accepté" };
    }

    const path = `${ticketId}/${phase}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await session.supabase.storage
      .from("repair_media")
      .upload(path, file, { contentType: file.type });

    if (uploadError) return { ok: false, error: uploadError.message };

    const { error } = await session.supabase.from("repair_photos").insert({
      repair_ticket_id: ticketId,
      phase,
      storage_path: path,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath(`/atelier`);
    return { ok: true, data: { path } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
