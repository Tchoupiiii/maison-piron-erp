"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, type StaffSession } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { formatEUR } from "@/lib/constants";
import { actionError, type ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type PriceChangeReason = Database["public"]["Enums"]["price_change_reason"];

export type PriceResult = {
  metalCost: number;
  stoneCost: number;
  laborCost: number;
  marginMultiplier: number;
  ht: number;
  ttc: number;
  rateDateUsed: string | null;
  hasMissingRate: boolean;
};

/**
 * Calcule via la RPC — seule source de vérité — puis met à jour le cache et
 * l'historique. Ne jamais persister un prix venu du client.
 */
async function computeAndPersist(
  { supabase }: StaffSession,
  productId: string,
  reason: PriceChangeReason,
): Promise<PriceResult> {
  const { data, error } = await supabase.rpc("calculate_dynamic_price", {
    product_id_param: productId,
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Calcul de prix sans résultat");

  await supabase
    .from("products")
    .update({
      cached_metal_cost: row.metal_cost,
      cached_stone_cost: row.stone_cost,
      cached_ht: row.ht,
      cached_ttc: row.ttc,
      price_computed_at: new Date().toISOString(),
    })
    .eq("id", productId);

  await supabase.from("price_history").insert({
    product_id: productId,
    metal_cost: row.metal_cost,
    stone_cost: row.stone_cost,
    labor_cost: row.labor_cost,
    margin_multiplier: row.margin_multiplier,
    ht: row.ht,
    ttc: row.ttc,
    reason,
    rate_date_used: row.rate_date_used,
  });

  return {
    metalCost: row.metal_cost,
    stoneCost: row.stone_cost,
    laborCost: row.labor_cost,
    marginMultiplier: row.margin_multiplier,
    ht: row.ht,
    ttc: row.ttc,
    rateDateUsed: row.rate_date_used,
    hasMissingRate: row.has_missing_rate,
  };
}

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
