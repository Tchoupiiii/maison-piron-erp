"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { sendEmail, notifyAdmin } from "@/lib/email/resend";
import { invoiceEmail } from "@/lib/email/templates";
import { getMaison } from "@/lib/maison";
import { INVOICE_DUE_DAYS, formatEUR } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type PaymentMethod = Database["public"]["Enums"]["payment_method"];

const createSaleSchema = z.object({
  customerId: z.string().uuid().nullish(),
  terminalId: z.string().uuid().nullish(),
  paymentMethod: z
    .enum(["especes", "bancontact", "carte", "virement", "mixte"])
    .nullish(),
  discount: z.number().nonnegative().default(0),
  markPaid: z.boolean().default(false),
  emitInvoice: z.boolean().default(false),
  /** Panier ayant réservé les pièces : sans lui, la base refuse de vendre une pièce tenue. */
  cartRef: z.string().trim().min(1).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid().nullish(),
        repairTicketId: z.string().uuid().nullish(),
        quantity: z.number().int().positive().default(1),
      }),
    )
    .min(1, "Une vente comporte au moins une ligne"),
});

/**
 * Toute la vente tient dans `create_sale` : les prix sont dérivés en base par
 * la RPC de calcul, la numérotation est sérialisée, et un échec en cours de
 * route annule l'ensemble. Le montant envoyé par la caisse n'est jamais retenu.
 */
export async function createSale(
  input: z.input<typeof createSaleSchema>,
): Promise<
  ActionResult<{ transactionId: string; ref: string | null; totalAmount: number }>
> {
  const parsed = createSaleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Vente incomplète",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.ventesCreer);
    const d = parsed.data;

    const { data, error } = await session.supabase.rpc("create_sale", {
      items_param: d.items.map((i) => ({
        product_id: i.productId ?? null,
        repair_ticket_id: i.repairTicketId ?? null,
        quantity: i.quantity,
      })),
      customer_id_param: d.customerId ?? undefined,
      terminal_id_param: d.terminalId ?? undefined,
      payment_method_param: (d.paymentMethod as PaymentMethod) ?? undefined,
      discount_param: d.discount,
      mark_paid_param: d.markPaid,
      emit_invoice_param: d.emitInvoice,
      cart_ref_param: d.cartRef ?? undefined,
    });

    if (error) return { ok: false, error: actionError(error) };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: "Vente non enregistrée" };

    await logActivity(session, {
      action: "vente_creee",
      summary: `${row.transaction_ref ?? "Brouillon"} · ${formatEUR(row.total_amount)} · ${d.items.length} ligne(s)`,
      entityType: "transaction",
      entityId: row.transaction_id,
      entityLabel: row.transaction_ref ?? undefined,
      changes: {
        apres: {
          total: row.total_amount,
          remise: d.discount,
          paiement: d.paymentMethod ?? null,
        },
      },
    });

    revalidatePath("/ventes");
    revalidatePath("/inventaire");
    revalidatePath("/dashboard");
    return {
      ok: true,
      data: {
        transactionId: row.transaction_id,
        ref: row.transaction_ref,
        totalAmount: row.total_amount,
      },
    };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Numérotation et statut sont attribués par `emit_invoice`. Une facture émise
 * n'est plus modifiable depuis l'API : conservation 7 ans, art. 60 CTVA.
 */
export async function emitInvoice(
  transactionId: string,
): Promise<ActionResult<{ ref: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.ventesFacturer);

    const { data, error } = await session.supabase.rpc("emit_invoice", {
      transaction_id_param: transactionId,
      due_days_param: INVOICE_DUE_DAYS,
    });

    if (error) return { ok: false, error: actionError(error) };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: "Facture non émise" };

    await logActivity(session, {
      action: "facture_emise",
      summary: `Facture ${row.ref} · ${formatEUR(row.total_amount)} · échéance ${row.due_at}`,
      entityType: "transaction",
      entityId: transactionId,
      entityLabel: row.ref,
    });

    if (row.customer_email) {
      const mail = invoiceEmail(await getMaison(), {
        customerName: row.customer_name ?? "",
        ref: row.ref,
        totalAmount: row.total_amount,
        dueAt: row.due_at,
      });
      try {
        await sendEmail({ to: row.customer_email, ...mail });
        await session.supabase.rpc("mark_invoice_sent", {
          transaction_id_param: transactionId,
        });
      } catch {
        // la facture est légalement émise même si l'envoi échoue
        await notifyAdmin(
          `Facture ${row.ref} non transmise`,
          `<p>La facture ${row.ref} est émise mais l'e-mail n'est pas parti. À renvoyer manuellement.</p>`,
        );
      }
    }

    revalidatePath("/ventes");
    revalidatePath(`/ventes/${transactionId}`);
    return { ok: true, data: { ref: row.ref } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function recordPayment(
  transactionId: string,
  amount: number,
): Promise<ActionResult<{ amountPaid: number; outstanding: number }>> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Montant invalide" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.ventesPaiement);

    const { data, error } = await session.supabase.rpc("record_payment", {
      transaction_id_param: transactionId,
      amount_param: amount,
    });

    if (error) return { ok: false, error: actionError(error) };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: "Paiement non enregistré" };

    await logActivity(session, {
      action: "paiement_enregistre",
      summary: `Règlement de ${formatEUR(amount)} · solde ${formatEUR(row.outstanding)}`,
      entityType: "transaction",
      entityId: transactionId,
      changes: { apres: { encaisse: row.amount_paid, solde: row.outstanding } },
    });

    revalidatePath("/ventes");
    revalidatePath(`/ventes/${transactionId}`);
    revalidatePath("/dashboard");
    return { ok: true, data: { amountPaid: row.amount_paid, outstanding: row.outstanding } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Retour d'une pièce vendue.
 *
 * La vente d'origine n'est ni modifiée ni supprimée : la base émet une note de
 * crédit distincte, à montant négatif, et remet la pièce en stock — disponible
 * aussitôt en boutique comme en ligne. C'est la voie comptable belge, et la
 * seule compatible avec l'obligation de conservation de 7 ans.
 */
export async function returnSoldItem(
  transactionItemId: string,
  reason?: string,
): Promise<ActionResult<{ creditNoteId: string; ref: string; amount: number }>> {
  try {
    const session = await requirePermission(PERMISSIONS.ventesRetour);

    const { data, error } = await session.supabase.rpc("return_sold_item", {
      transaction_item_id_param: transactionItemId,
      reason_param: reason ?? undefined,
    });

    if (error) return { ok: false, error: actionError(error) };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: "Retour non enregistré" };

    await logActivity(session, {
      action: "vente_creee",
      summary: `Retour · note de crédit ${row.credit_note_ref} · ${formatEUR(row.amount)}`,
      entityType: "transaction",
      entityId: row.credit_note_id,
      entityLabel: row.credit_note_ref,
      changes: { apres: { avoir: row.credit_note_ref, montant: row.amount } },
    });

    revalidatePath("/ventes");
    revalidatePath("/inventaire");
    revalidatePath("/dashboard");
    return {
      ok: true,
      data: { creditNoteId: row.credit_note_id, ref: row.credit_note_ref, amount: row.amount },
    };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
