"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { isEmailConfigured, sendEmail } from "@/lib/email/resend";
import { rgpdReceiptEmail } from "@/lib/email/templates";
import { getMaison } from "@/lib/maison";
import { ANONYMIZED_NAME, RGPD_CONFIRMATION_WORD } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";

/**
 * Effacement art. 17 : les coordonnées disparaissent, la ligne client et son
 * identifiant restent pour que les factures liées demeurent auditables
 * pendant les 7 ans imposés par l'art. 60 CTVA.
 *
 * Le mot de confirmation est revalidé ici : le contrôle du dialogue est une
 * protection d'interface, pas une protection tout court.
 */
export async function anonymizeCustomer(
  customerId: string,
  confirmationText: string,
): Promise<ActionResult<{ anonymizedAt: string; receiptSent: boolean }>> {
  if (confirmationText.trim().toUpperCase() !== RGPD_CONFIRMATION_WORD) {
    return { ok: false, error: `Saisissez « ${RGPD_CONFIRMATION_WORD} » pour confirmer` };
  }

  try {
    const session = await requirePermission(PERMISSIONS.clienteleRgpd);
    const { supabase, userId } = session;

    const { data: customer, error: readError } = await supabase
      .from("customers")
      .select("id, full_name, email, is_anonymized")
      .eq("id", customerId)
      .single();

    if (readError) return { ok: false, error: readError.message };
    if (customer.is_anonymized) {
      return { ok: false, error: "Cette fiche est déjà anonymisée" };
    }

    // Le reçu part avant l'effacement : après, l'adresse n'existe plus.
    let receiptSentAt: string | null = null;
    let receiptNote = "Aucune adresse e-mail au dossier : pas de reçu";

    if (customer.email) {
      if (!isEmailConfigured()) {
        // Aucun fournisseur branché : on n'immobilise pas un droit à l'effacement
        // pour autant, mais la trace le dit noir sur blanc.
        receiptNote =
          "Reçu non envoyé : aucun fournisseur e-mail configuré au moment de l'opération";
      } else {
        const mail = rgpdReceiptEmail(await getMaison(), { customerName: customer.full_name ?? "" });
        try {
          await sendEmail({ to: customer.email, ...mail });
          receiptSentAt = new Date().toISOString();
          receiptNote = "Reçu d'exécution envoyé avant effacement";
        } catch (error) {
          return {
            ok: false,
            error:
              "Reçu d'exécution non délivré : anonymisation interrompue. " +
              `Vérifiez l'adresse du client. (${(error as Error).message})`,
          };
        }
      }
    }

    const anonymizedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("customers")
      .update({
        full_name: ANONYMIZED_NAME,
        email: null,
        phone: null,
        street: null,
        postal_code: null,
        city: null,
        is_privilege: false,
        is_anonymized: true,
        anonymized_at: anonymizedAt,
      })
      .eq("id", customerId);

    if (updateError) return { ok: false, error: updateError.message };

    const { error: prefsError } = await supabase
      .from("customer_preferences")
      .delete()
      .eq("customer_id", customerId);

    if (prefsError) return { ok: false, error: prefsError.message };

    await supabase.from("customer_consents").delete().eq("customer_id", customerId);

    await supabase.from("rgpd_action_log").insert({
      customer_id: customerId,
      action: "anonymisation",
      performed_by: userId,
      receipt_sent_at: receiptSentAt,
      notes: receiptNote,
    });

    await logActivity(session, {
      action: "client_anonymise",
      summary: `Fiche de ${customer.full_name ?? "client"} anonymisée · ${receiptNote}`,
      entityType: "customer",
      entityId: customerId,
      entityLabel: customer.full_name ?? undefined,
    });

    revalidatePath("/clientele");
    revalidatePath(`/clientele/${customerId}`);
    return { ok: true, data: { anonymizedAt, receiptSent: receiptSentAt !== null } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export type CustomerExport = {
  exportedAt: string;
  customer: Record<string, unknown>;
  preferences: Record<string, unknown> | null;
  consents: Record<string, unknown>[];
  purchases: Record<string, unknown>[];
  repairs: Record<string, unknown>[];
};

/** Portabilité art. 20 : dump lisible remis au client, jamais stocké. */
export async function exportCustomerData(
  customerId: string,
): Promise<ActionResult<CustomerExport>> {
  try {
    const session = await requirePermission(PERMISSIONS.clienteleRgpd);
    const { supabase, userId } = session;

    const { data: customer, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .single();

    if (error) return { ok: false, error: error.message };

    const [preferences, consents, purchases, repairs] = await Promise.all([
      supabase
        .from("customer_preferences")
        .select("*")
        .eq("customer_id", customerId)
        .maybeSingle(),
      supabase.from("customer_consents").select("*").eq("customer_id", customerId),
      supabase
        .from("transactions")
        .select(
          "ref, status, total_amount, amount_paid, issued_at, created_at, transaction_items(description, quantity, unit_price_ht, line_total_ttc)",
        )
        .eq("customer_id", customerId),
      supabase
        .from("repair_tickets")
        .select(
          "ref, description, received_date, deadline, status, estimated_price, actual_price",
        )
        .eq("customer_id", customerId),
    ]);

    await supabase.from("rgpd_action_log").insert({
      customer_id: customerId,
      action: "export",
      performed_by: userId,
    });

    await logActivity(session, {
      action: "client_exporte",
      summary: `Export de portabilité pour ${customer.full_name ?? "un client"}`,
      entityType: "customer",
      entityId: customerId,
      entityLabel: customer.full_name ?? undefined,
    });

    return {
      ok: true,
      data: {
        exportedAt: new Date().toISOString(),
        customer,
        preferences: preferences.data,
        consents: consents.data ?? [],
        purchases: purchases.data ?? [],
        repairs: repairs.data ?? [],
      },
    };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
