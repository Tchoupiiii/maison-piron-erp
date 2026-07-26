"use client";

import { useMemo, useState } from "react";
import { calculatePrice, ratePerGramForPurity } from "@/lib/pricing/engine";
import { formatEUR } from "@/lib/constants";
import { inputClass, labelClass } from "@/components/ui";
import type { Database } from "@/types/database.types";

type MetalKind = Database["public"]["Enums"]["metal_kind"];

type Title = { metal_kind: MetalKind; purity_per_mille: number; label: string };

type SimGemstone = {
  id: string;
  name: string;
  caratWeight: number;
  stoneCount: number;
  pricePerCarat: number;
};

/**
 * Aperçu interactif seulement : le prix persisté vient toujours de la RPC SQL.
 * Les deux implémentations partagent la même formule (src/lib/pricing/engine.ts).
 */
export function PriceSimulator({
  titles,
  rates,
  initial,
  initialGemstones,
}: {
  titles: Title[];
  rates: Partial<Record<MetalKind, number>>;
  initial: {
    metalKind: MetalKind;
    purityPerMille: number;
    weightGrams: number;
    laborCostEur: number;
    marginMultiplier: number;
  };
  initialGemstones: SimGemstone[];
}) {
  const [metalKind, setMetalKind] = useState<MetalKind>(initial.metalKind);
  const [purity, setPurity] = useState(initial.purityPerMille);
  const [weight, setWeight] = useState(initial.weightGrams);
  const [labor, setLabor] = useState(initial.laborCostEur);
  const [margin, setMargin] = useState(initial.marginMultiplier);
  const [gemstones, setGemstones] = useState<SimGemstone[]>(initialGemstones);

  const availableTitles = titles.filter((t) => t.metal_kind === metalKind);
  const rate = rates[metalKind];

  function patchGemstone(id: string, patch: Partial<SimGemstone>) {
    setGemstones((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  const breakdown = useMemo(
    () =>
      calculatePrice({
        materials: [{ metal_kind: metalKind, purity_per_mille: purity, weight_grams: weight }],
        gemstones: gemstones.map((g) => ({
          carat_weight: g.caratWeight,
          stone_count: g.stoneCount,
          price_per_carat: g.pricePerCarat,
        })),
        laborCostEur: labor,
        marginMultiplier: margin,
        ratesPerGramFine: rates as Record<string, number>,
      }),
    [metalKind, purity, weight, labor, margin, gemstones, rates],
  );

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Métal</span>
          <select
            value={metalKind}
            onChange={(e) => {
              const next = e.target.value as MetalKind;
              setMetalKind(next);
              const first = titles.find((t) => t.metal_kind === next);
              if (first) setPurity(first.purity_per_mille);
            }}
            className="h-9 rounded-pill border border-hairline bg-paper px-3 text-body"
          >
            <option value="or">Or</option>
            <option value="argent">Argent</option>
            <option value="platine">Platine</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Titre / carat</span>
          <select
            value={purity}
            onChange={(e) => setPurity(Number(e.target.value))}
            className="h-9 rounded-pill border border-hairline bg-paper px-3 text-body"
          >
            {availableTitles.map((t) => (
              <option key={t.purity_per_mille} value={t.purity_per_mille}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Poids · {weight.toFixed(3)} g</span>
          <input
            type="range"
            min={0}
            max={80}
            step={0.1}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="accent-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Façon · {formatEUR(labor)}</span>
          <input
            type="range"
            min={0}
            max={3000}
            step={10}
            value={labor}
            onChange={(e) => setLabor(Number(e.target.value))}
            className="accent-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Coefficient · ×{margin.toFixed(2)}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.05}
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value))}
            className="accent-ink"
          />
        </label>
      </div>

      {gemstones.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-hairline pt-4">
          <span className={labelClass}>Pierres (simulation locale)</span>
          {gemstones.map((g) => (
            <div
              key={g.id}
              className="grid grid-cols-[1fr_repeat(3,minmax(90px,110px))] items-end gap-3"
            >
              <span className="pb-2 text-body">{g.name}</span>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Poids (ct)</span>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={g.caratWeight}
                  onChange={(e) => patchGemstone(g.id, { caratWeight: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Nombre</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={g.stoneCount}
                  onChange={(e) => patchGemstone(g.id, { stoneCount: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Prix / ct (€)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={g.pricePerCarat}
                  onChange={(e) => patchGemstone(g.id, { pricePerCarat: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 border-t border-hairline pt-4">
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>Cours appliqué</dt>
          <dd className="tabular text-body">
            {rate ? `${formatEUR(ratePerGramForPurity(rate, purity))} /g` : "cours manquant"}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>Métal</dt>
          <dd className="tabular text-body">{formatEUR(breakdown.metalCost)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>Pierres</dt>
          <dd className="tabular text-body">{formatEUR(breakdown.stoneCost)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>HT</dt>
          <dd className="tabular text-body">{formatEUR(breakdown.ht)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>TTC simulé</dt>
          <dd className="tabular text-heading-sm font-medium">{formatEUR(breakdown.ttc)}</dd>
        </div>
      </dl>

      <p className="text-caption text-mid-gray">
        Simulation locale. Le prix de vente reste celui calculé et enregistré par la
        base — utilisez « Enregistrer et recalculer » pour le figer.
      </p>
    </div>
  );
}
