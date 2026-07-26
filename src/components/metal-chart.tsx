"use client";

import { useEffect, useRef, useState } from "react";
import { formatEUR } from "@/lib/constants";

type Point = { date: string; value: number };

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

export function MetalChart({ label, points }: { label: string; points: Point[] }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const count = points.length;
  const min = count ? Math.min(...points.map((p) => p.value)) : 0;
  const max = count ? Math.max(...points.map((p) => p.value)) : 0;
  const span = max - min || Math.abs(max) * 0.01 || 1;

  const innerWidth = Math.max(0, width - GUTTER_LEFT - PAD_RIGHT);
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xAt = (index: number) =>
    GUTTER_LEFT + (count > 1 ? (index / (count - 1)) * innerWidth : innerWidth / 2);
  const yAt = (value: number) => PAD_TOP + (1 - (value - min) / span) * innerHeight;

  const ticks = [max, (min + max) / 2, min];
  const last = count ? points[count - 1] : null;
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body font-medium">{label}</span>
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
            aria-label={`Courbe du cours — ${label}`}
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
                points={points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(" ")}
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
          <span>{points[0]?.date ?? ""}</span>
          <span>{count > 2 ? points[Math.floor(count / 2)]?.date : ""}</span>
          <span>{count > 1 ? last?.date : ""}</span>
        </div>
      )}
    </div>
  );
}
