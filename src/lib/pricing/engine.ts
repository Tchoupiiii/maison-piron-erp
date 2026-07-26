import { VAT_RATE } from "@/lib/constants";
import type { Database } from "@/types/database.types";

type MetalKind = Database["public"]["Enums"]["metal_kind"];

export type PricingMaterial = {
  metal_kind: MetalKind;
  purity_per_mille: number;
  weight_grams: number;
};

export type PricingGemstone = {
  carat_weight: number;
  stone_count: number;
  price_per_carat: number;
};

export type PricingInput = {
  materials: PricingMaterial[];
  gemstones: PricingGemstone[];
  laborCostEur: number;
  marginMultiplier: number;
  /** Cours du métal pur (999 ‰) en €/g, par type de métal. */
  ratesPerGramFine: Partial<Record<MetalKind, number>>;
};

export type PriceBreakdown = {
  metalCost: number;
  stoneCost: number;
  laborCost: number;
  marginMultiplier: number;
  ht: number;
  ttc: number;
  hasMissingRate: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Miroir TypeScript de la fonction SQL `calculate_dynamic_price`.
 * Sert uniquement à l'aperçu interactif (sliders de la fiche pièce) : tout prix
 * persisté doit venir de la RPC, seule source de vérité.
 */
export function calculatePrice(input: PricingInput): PriceBreakdown {
  let metalCost = 0;
  let hasMissingRate = false;

  for (const m of input.materials) {
    const rate = input.ratesPerGramFine[m.metal_kind];
    if (rate === undefined) {
      hasMissingRate = true;
      continue;
    }
    metalCost += m.weight_grams * rate * (m.purity_per_mille / 1000);
  }

  const stoneCost = input.gemstones.reduce(
    (sum, g) => sum + g.carat_weight * g.stone_count * g.price_per_carat,
    0,
  );

  const roundedMetal = round2(metalCost);
  const roundedStone = round2(stoneCost);
  const ht = round2(
    (roundedMetal + roundedStone + input.laborCostEur) * input.marginMultiplier,
  );

  return {
    metalCost: roundedMetal,
    stoneCost: roundedStone,
    laborCost: input.laborCostEur,
    marginMultiplier: input.marginMultiplier,
    ht,
    ttc: round2(ht * (1 + VAT_RATE)),
    hasMissingRate,
  };
}

/** Cours affiché pour un titre donné, ex. or 18k = cours pur × 750/1000. */
export function ratePerGramForPurity(
  ratePerGramFine: number,
  purityPerMille: number,
): number {
  return round2(ratePerGramFine * (purityPerMille / 1000));
}
