"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatEUR } from "@/lib/constants";
import { ratePerGramForPurity } from "@/lib/pricing/engine";
import type { Database } from "@/types/database.types";

type MetalKind = Database["public"]["Enums"]["metal_kind"];
type Point = { date: string; value: number };
type Title = { purity_per_mille: number; label: string };

/* Le SVG est rendu à la taille réelle du conteneur (1 unité = 1 px CSS) :
   aucune déformation quelle que soit la largeur de fenêtre, contrairement à
   un viewBox fixe étiré par preserveAspectRatio="none". */
const HEIGHT = 200;
const PAD_TOP = 16;
const PAD_BOTTOM = 12;
const GUTTER_LEFT = 64;
const PAD_RIGHT = 20;

/** Trait horizontal net : centré sur la moitié de pixel. */
const crisp = (y: number) => Math.round(y) + 0.5;

/**
 * Titre mémorisé par métal, par navigateur : lu après le montage (jamais
 * pendant le rendu serveur) pour ne pas produire de mismatch d'hydratation —
 * le premier rendu affiche toujours le titre par défaut (999 ‰, or/argent fin).
 */
function storageKey(metalKind: MetalKind): string {
  return `mp:cours-purity:${metalKind}`;
}

export function MetalChart({
  label,
  points,
  metalKind,
  titles,
}: {
  label: string;
  points: Point[];
  metalKind: MetalKind;
  titles: Title[];
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [purity, setPurity] = useState(999);

  useEffect(() => {
    const stored = Number(localStorage.getItem(storageKey(metalKind)));
    if (stored && titles.some((t) => t.purity_per_mille === stored)) {
      setPurity(stored);
    }
    // Un seul métal par instance : pas besoin de re-suivre metalKind/titles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectPurity(value: number) {
    setPurity(value);
    localStorage.setItem(storageKey(metalKind), String(value));
  }

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const convertedPoints = useMemo(
    () => points.map((p) => ({ date: p.date, value: ratePerGramForPurity(p.value, purity) })),
    [points, purity],
  );

  const count = convertedPoints.length;
  const min = count ? Math.min(...convertedPoints.map((p) => p.value)) : 0;
  const max = count ? Math.max(...convertedPoints.map((p) => p.value)) : 0;
  // Toutes les valeurs visibles sont égales (période courte, cours inchangé) :
  // un vrai span à 0 ferait retomber min/milieu/max sur la même position et
  // leurs étiquettes se chevaucheraient. On centre alors une ligne plate.
  const isFlat = max - min === 0;

  const innerWidth = Math.max(0, width - GUTTER_LEFT - PAD_RIGHT);
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xAt = (index: number) =>
    GUTTER_LEFT + (count > 1 ? (index / (count - 1)) * innerWidth : innerWidth / 2);
  const yAt = (value: number) =>
    isFlat
      ? PAD_TOP + innerHeight / 2
      : PAD_TOP + (1 - (value - min) / (max - min)) * innerHeight;

  const ticks = isFlat ? [max] : [max, (min + max) / 2, min];
  const last = count ? convertedPoints[count - 1] : null;
  const hovered = hoverIndex !== null ? convertedPoints[hoverIndex] : null;
  const currentTitle = titles.find((t) => t.purity_per_mille === purity);

  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <span className="text-body font-medium">{label}</span>
          {titles.length > 0 && (
            <select
              value={purity}
              onChange={(e) => selectPurity(Number(e.target.value))}
              className="h-7 rounded-pill border border-hairline bg-paper px-2 text-caption text-mid-gray outline-none focus:border-ink"
              aria-label={`Titre affiché pour ${label}`}
            >
              {titles.map((t) => (
                <option key={t.purity_per_mille} value={t.purity_per_mille}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </div>
        {last && (
          <span className="tabular text-[13px] text-mid-gray">
            {formatEUR(last.value)} /g · {last.date}
          </span>
        )}
      </div>

      <div ref={wrapperRef} className="relative w-full" style={{ height: HEIGHT }}>
        {count === 0 && (
          <p className="flex h-full items-center text-body text-mid-gray">
            Historique en construction : un point s&apos;ajoute à chaque
            synchronisation quotidienne des cours.
          </p>
        )}

        {count > 0 && width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={`Courbe du cours — ${label}${currentTitle ? ` · ${currentTitle.label}` : ""}`}
            onPointerMove={(event) => {
              if (count < 2) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientX - rect.left - GUTTER_LEFT) / innerWidth;
              const index = Math.round(ratio * (count - 1));
              setHoverIndex(Math.min(count - 1, Math.max(0, index)));
            }}
            onPointerLeave={() => setHoverIndex(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={GUTTER_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={crisp(yAt(tick))}
                  y2={crisp(yAt(tick))}
                  className="stroke-hairline"
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
                <text
                  x={GUTTER_LEFT - 8}
                  y={yAt(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="tabular fill-mid-gray"
                  fontSize="11"
                >
                  {formatEUR(tick)}
                </text>
              </g>
            ))}

            {count >= 2 && (
              <polyline
                points={convertedPoints
                  .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`)
                  .join(" ")}
                fill="none"
                className="stroke-ink"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {hovered && hoverIndex !== null && (
              <line
                x1={xAt(hoverIndex)}
                x2={xAt(hoverIndex)}
                y1={PAD_TOP}
                y2={HEIGHT - PAD_BOTTOM}
                className="stroke-hairline"
                strokeWidth="1"
              />
            )}

            {last && (
              <circle
                cx={xAt(count - 1)}
                cy={yAt(last.value)}
                r="3"
                className="fill-ink"
              />
            )}

            {hovered && hoverIndex !== null && (
              <circle
                cx={xAt(hoverIndex)}
                cy={yAt(hovered.value)}
                r="3"
                className="fill-ink"
              />
            )}
          </svg>
        )}

        {hovered && hoverIndex !== null && width > 0 && (
          <div
            className="pointer-events-none absolute z-10 rounded-sm border border-hairline bg-paper px-2 py-1 shadow-card"
            style={{
              left: Math.min(Math.max(xAt(hoverIndex), GUTTER_LEFT + 40), width - 60),
              top: Math.max(0, yAt(hovered.value) - 12),
              transform: "translate(-50%, -100%)",
            }}
          >
            <span className="tabular block whitespace-nowrap text-caption text-ink">
              {formatEUR(hovered.value)} /g
            </span>
            <span className="tabular block whitespace-nowrap text-caption text-mid-gray">
              {hovered.date}
            </span>
          </div>
        )}
      </div>

      {count > 0 && (
        <div
          className="tabular flex justify-between text-caption text-mid-gray"
          style={{ paddingLeft: GUTTER_LEFT, paddingRight: PAD_RIGHT }}
        >
          <span>{convertedPoints[0]?.date ?? ""}</span>
          <span>{count > 2 ? convertedPoints[Math.floor(count / 2)]?.date : ""}</span>
          <span>{count > 1 ? last?.date : ""}</span>
        </div>
      )}
    </div>
  );
}
