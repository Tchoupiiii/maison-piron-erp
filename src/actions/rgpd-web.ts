"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";

/**
 * Rétention RGPD des demandes du site (web_enquiries) : `anonymizeCustomer`
 * ne couvre que les clients, pas les prospects. La RPC applique elle-même la
 * politique (12 mois si jamais traitée, 24 mois après traitement) ; cette
 * action ne fait que la déclencher manuellement et journaliser côté ERP —
 * il n'y a pas encore d'automatisation planifiée pour cette itération.
 */
export async function anonymizeStaleEnquiriesAction(): Promise<ActionResult<{ count: number }>> {
  try {
    const session = await requirePermission(PERMISSIONS.clienteleRgpd);

    const { data, error } = await session.supabase.rpc("anonymize_stale_web_enquiries");
    if (error) return { ok: false, error: actionError(error) };

    const count = data ?? 0;
    if (count > 0) {
      await logActivity(session, {
        action: "web_enquiry_anonymisee",
        summary: `${count} demande(s) du site anonymisée(s) (rétention RGPD)`,
        entityType: "web_enquiry",
      });
    }

    revalidatePath("/demandes");
    return { ok: true, data: { count } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
