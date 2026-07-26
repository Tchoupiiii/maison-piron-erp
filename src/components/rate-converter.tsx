"use client";

import { useState } from "react";
import { ratePerGramForPurity } from "@/lib/pricing/engine";
import { formatEUR, METAL_LABELS, TROY_OUNCE_GRAMS } from "@/lib/constants";
import { inputClass, labelClass, selectClass } from "@/components/ui";
import type { Database } from "@/types/database.types";

type MetalKind = Database["public"]["Enums"]["metal_kind"];

/** Convertisseur métal × titre : n'importe quel carat, y compris hors référentiel. */
export function RateConverter({
  titles,
  rates,
}: {
  titles: { metal_kind: MetalKind; purity_per_mille: number; label: string }[];
  rates: Partial<Record<MetalKind, number>>;
}) {
  const [metal, setMetal] = useState<MetalKind>("or");
  const [purity, setPurity] = useState(750);
  const [weight, setWeight] = useState(1);

  const fine = rates[metal];
  const perGram = fine ? ratePerGramForPurity(fine, purity) : null;
  const available = titles.filter((t) => t.metal_kind === metal);

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Métal</span>
          <select
            value={metal}
            onChange={(e) => {
              const next = e.target.value as MetalKind;
              setMetal(next);
              const first = titles.find((t) => t.metal_kind === next);
              if (first) setPurity(first.purity_per_mille);
            }}
            className={selectClass}
          >
            {(Object.keys(METAL_LABELS) as MetalKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {METAL_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Titre / carat</span>
          <select
            value={purity}
            onChange={(e) => setPurity(Number(e.target.value))}
            className={selectClass}
          >
            {available.map((t) => (
              <option key={t.purity_per_mille} value={t.purity_per_mille}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Titre libre (‰)</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={purity}
            onChange={(e) => setPurity(Number(e.target.value))}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Poids (g)</span>
          <input
            type="number"
            min={0}
            step="0.001"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className={inputClass}
          />
        </label>
      </div>

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 border-t border-hairline pt-4">
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>Métal fin (999 ‰)</dt>
          <dd className="tabular text-body">{fine ? `${formatEUR(fine)} /g` : "—"}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>À l&apos;once troy</dt>
          <dd className="tabular text-body">
            {fine ? formatEUR(fine * TROY_OUNCE_GRAMS) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>Au titre {purity} ‰</dt>
          <dd className="tabular text-body">{perGram ? `${formatEUR(perGram)} /g` : "—"}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={labelClass}>Valeur de {weight} g</dt>
          <dd className="tabular text-heading-sm font-medium">
            {perGram ? formatEUR(perGram * weight) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
