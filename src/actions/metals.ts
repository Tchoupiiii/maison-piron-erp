"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { syncMetalRates } from "@/lib/metals/sync";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";

/**
 * « Forcer une synchronisation » : passe par la session de l'employé, donc ne
 * dépend pas de la clé service_role réservée au Cron.
 */
export async function syncMetalRatesNow(): Promise<
  ActionResult<{ status: string; ratesUpserted: number; missing: string[]; durationMs: number }>
> {
  try {
    const session = await requirePermission(PERMISSIONS.metauxSync);
    const outcome = await syncMetalRates(session.supabase, "manuel");

    await logActivity(session, {
      action: "sync_metaux",
      summary:
        outcome.status === "echec"
          ? `Synchronisation en échec : ${outcome.errorMessage ?? "cause inconnue"}`
          : `${outcome.ratesUpserted} cours mis à jour depuis ${outcome.source} en ${outcome.durationMs} ms`,
      entityType: "market_rates",
      changes: outcome.eurPerGram,
    });

    revalidatePath("/cours-metaux");
    revalidatePath("/dashboard");

    if (outcome.status === "echec") {
      return {
        ok: false,
        error: outcome.errorMessage ?? "Aucun cours récupéré",
      };
    }

    return {
      ok: true,
      data: {
        status: outcome.status,
        ratesUpserted: outcome.ratesUpserted,
        missing: outcome.missing,
        durationMs: outcome.durationMs,
      },
    };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
