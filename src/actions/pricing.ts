"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { formatEUR } from "@/lib/constants";
import { actionError, type ActionResult } from "@/actions/types";
import { computeAndPersist, type PriceResult } from "@/lib/pricing/persist";

export async function recalculateProductPrice(
  productId: string,
): Promise<ActionResult<PriceResult>> {
  try {
    const session = await requirePermission(PERMISSIONS.inventairePrix);

    const { data: before } = await session.supabase
      .from("products")
      .select("sku, name, cached_ttc")
      .eq("id", productId)
      .single();

    const result = await computeAndPersist(session, productId, "edition_manuelle");

    await logActivity(session, {
      action: "prix_recalcule",
      summary: `Étiquette recalculée : ${formatEUR(before?.cached_ttc ?? 0)} → ${formatEUR(result.ttc)}`,
      entityType: "product",
      entityId: productId,
      entityLabel: before ? `${before.name} · ${before.sku}` : undefined,
      changes: { avant: { ttc: before?.cached_ttc ?? null }, apres: { ttc: result.ttc } },
    });

    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/inventaire");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function setProductPricingInputs(
  productId: string,
  input: { laborCostEur?: number; marginMultiplier?: number; laborDescription?: string },
): Promise<ActionResult<PriceResult>> {
  if (input.marginMultiplier !== undefined && input.marginMultiplier <= 0) {
    return { ok: false, error: "Le coefficient doit être supérieur à zéro" };
  }
  if (input.laborCostEur !== undefined && input.laborCostEur < 0) {
    return { ok: false, error: "La façon ne peut pas être négative" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.inventairePrix);

    const { data: before, error: readError } = await session.supabase
      .from("products")
      .select("sku, name, labor_cost_eur, margin_multiplier, labor_description")
      .eq("id", productId)
      .single();

    if (readError) return { ok: false, error: readError.message };

    const { error } = await session.supabase
      .from("products")
      .update({
        ...(input.laborCostEur !== undefined && { labor_cost_eur: input.laborCostEur }),
        ...(input.marginMultiplier !== undefined && {
          margin_multiplier: input.marginMultiplier,
        }),
        ...(input.laborDescription !== undefined && {
          labor_description: input.laborDescription,
        }),
      })
      .eq("id", productId);

    if (error) return { ok: false, error: error.message };

    const result = await computeAndPersist(session, productId, "edition_manuelle");

    await logActivity(session, {
      action: "prix_modifie",
      summary: `Façon ${before.labor_cost_eur} € → ${input.laborCostEur ?? before.labor_cost_eur} €, coefficient ${before.margin_multiplier} → ${input.marginMultiplier ?? before.margin_multiplier}`,
      entityType: "product",
      entityId: productId,
      entityLabel: `${before.name} · ${before.sku}`,
      changes: {
        avant: {
          facon: before.labor_cost_eur,
          coefficient: before.margin_multiplier,
        },
        apres: {
          facon: input.laborCostEur ?? before.labor_cost_eur,
          coefficient: input.marginMultiplier ?? before.margin_multiplier,
        },
      },
    });

    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/inventaire");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * « Recalculer les X étiquettes » après une variation de cours.
 * Les pièces vendues gardent le prix figé au moment de la vente.
 */
export async function recalculatePricesForRateChange(): Promise<
  ActionResult<{ updatedCount: number; failedCount: number }>
> {
  try {
    const session = await requirePermission(PERMISSIONS.metauxRecalculer);

    // Seules les pièces dont l'étiquette repose sur un cours dépassé : recalculer
    // tout le stock gonflerait price_history de lignes identiques.
    const { data: productIds, error } = await session.supabase.rpc(
      "repriceable_product_ids",
    );

    if (error) return { ok: false, error: error.message };

    let updatedCount = 0;
    let failedCount = 0;

    for (const productId of productIds ?? []) {
      try {
        await computeAndPersist(session, productId, "sync_cours");
        updatedCount++;
      } catch {
        failedCount++;
      }
    }

    await logActivity(session, {
      action: "prix_recalcule",
      summary: `${updatedCount} étiquette(s) recalculée(s) après variation des cours${failedCount > 0 ? `, ${failedCount} en échec` : ""}`,
      entityType: "products",
    });

    revalidatePath("/inventaire");
    revalidatePath("/cours-metaux");
    revalidatePath("/dashboard");
    return { ok: true, data: { updatedCount, failedCount } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
