"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type EnquiryStatus = Database["public"]["Enums"]["enquiry_status"];

/* Suivi des demandes reçues du site.
 *
 *  Les commandes web, elles, ne se pilotent pas d'ici : une commande payée est
 *  devenue une `transactions`, qui se traite dans Ventes & factures. Un
 *  paiement qui n'a pas abouti se rejoue chez Mollie, pas à la main en base —
 *  d'où l'absence d'action « marquer payée ». */

export async function setEnquiryStatus(
  enquiryId: string,
  status: EnquiryStatus,
  note?: string,
): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(enquiryId).success) {
    return { ok: false, error: "Demande introuvable" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.webDemandes);

    const { data: before } = await session.supabase
      .from("web_enquiries")
      .select("full_name, email, kind")
      .eq("id", enquiryId)
      .maybeSingle();

    const { error } = await session.supabase.rpc("set_enquiry_status", {
      enquiry_id_param: enquiryId,
      status_param: status,
      note_param: note ?? undefined,
    });
    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "web_demande_recue",
      summary: `Demande de ${before?.full_name ?? "client"} : ${status}`,
      entityType: "web_enquiry",
      entityId: enquiryId,
      entityLabel: before?.email ?? undefined,
    });

    revalidatePath("/demandes");
    return { ok: true, data: { id: enquiryId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function setEnquiryStatusForm(
  enquiryId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const status = String(formData.get("status") ?? "en_cours") as EnquiryStatus;
  const note = String(formData.get("note") ?? "") || undefined;
  return setEnquiryStatus(enquiryId, status, note);
}
