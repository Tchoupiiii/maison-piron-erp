"use client";

import { useEffect, useMemo, useState } from "react";
import { MetalChart } from "@/components/metal-chart";
import { Card } from "@/components/ui";
import type { Database } from "@/types/database.types";

type MetalKind = Database["public"]["Enums"]["metal_kind"];
type Point = { date: string; value: number };
type Title = { purity_per_mille: number; label: string };

const STORAGE_KEY = "mp:cours-range";

const RANGES = [
  { key: "D1", label: "1 j", days: 1 },
  { key: "W1", label: "1 sem", days: 7 },
  { key: "M1", label: "1 mois", days: 30 },
  { key: "M6", label: "6 mois", days: 182 },
  { key: "Y1", label: "1 an", days: 365 },
  { key: "Y2", label: "2 ans", days: 730 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];
const DEFAULT_RANGE: RangeKey = "Y2";

function cutoffDate(lastDate: string, days: number): string {
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function MetalRatesCard({
  goldSeries,
  silverSeries,
  goldTitles,
  silverTitles,
}: {
  goldSeries: Point[];
  silverSeries: Point[];
  goldTitles: Title[];
  silverTitles: Title[];
}) {
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);

  useEffect(() => {
    // Lu uniquement après le montage : le premier rendu doit rester identique
    // au HTML serveur (défaut M6), sans quoi React signale un mismatch.
    const stored = localStorage.getItem(STORAGE_KEY) as RangeKey | null;
    if (stored && RANGES.some((r) => r.key === stored)) setRange(stored);
  }, []);

  function selectRange(key: RangeKey) {
    setRange(key);
    localStorage.setItem(STORAGE_KEY, key);
  }

  const lastDate = goldSeries.at(-1)?.date ?? silverSeries.at(-1)?.date ?? null;
  const activeRange = RANGES.find((r) => r.key === range) ?? RANGES.find((r) => r.key === DEFAULT_RANGE)!;

  const filteredGold = useMemo(() => {
    if (!lastDate) return goldSeries;
    const cutoff = cutoffDate(lastDate, activeRange.days);
    return goldSeries.filter((p) => p.date >= cutoff);
  }, [goldSeries, lastDate, activeRange]);

  const filteredSilver = useMemo(() => {
    if (!lastDate) return silverSeries;
    const cutoff = cutoffDate(lastDate, activeRange.days);
    return silverSeries.filter((p) => p.date >= cutoff);
  }, [silverSeries, lastDate, activeRange]);

  return (
    <Card
      title="Or et argent"
      subtitle="market_rates · euros par gramme · échelles indépendantes"
      aside={
        <div className="flex flex-wrap gap-1" role="group" aria-label="Période affichée">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => selectRange(r.key)}
              className={
                r.key === range
                  ? "inline-flex h-7 items-center justify-center rounded-pill bg-ink px-2.5 text-caption font-medium text-surface-alt"
                  : "inline-flex h-7 items-center justify-center rounded-pill border border-hairline px-2.5 text-caption text-mid-gray hover:bg-surface-alt"
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex flex-col divide-y divide-hairline">
        <MetalChart label="Or" points={filteredGold} metalKind="or" titles={goldTitles} />
        <MetalChart label="Argent" points={filteredSilver} metalKind="argent" titles={silverTitles} />
      </div>
    </Card>
  );
}
