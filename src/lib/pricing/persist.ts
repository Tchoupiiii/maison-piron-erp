import type { StaffSession } from "@/actions/auth-guard";
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
 *
 * Module volontairement hors `"use server"` : chaque action qui l'appelle
 * porte sa propre garde de permission, ce helper ne doit pas être joignable
 * par POST direct.
 */
export async function computeAndPersist(
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
