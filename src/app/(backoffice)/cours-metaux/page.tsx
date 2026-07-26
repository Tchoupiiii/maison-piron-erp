import { getStaffSession } from "@/actions/auth-guard";
import { syncMetalRatesNow } from "@/actions/metals";
import { recalculatePricesForRateChange } from "@/actions/pricing";
import { ActionButton } from "@/components/action-button";
import { RateConverter } from "@/components/rate-converter";
import {
  Badge,
  Card,
  Notice,
  PageHeader,
  Section,
  StatRow,
  buttonGhost,
  buttonPrimary,
} from "@/components/ui";
import { formatEUR, METAL_LABELS } from "@/lib/constants";
import { ratePerGramForPurity } from "@/lib/pricing/engine";
import { PERMISSIONS } from "@/lib/permissions";
import type { Database } from "@/types/database.types";

type MetalKind = Database["public"]["Enums"]["metal_kind"];

/** Trace une polyligne normalisée sur la hauteur du cadre. */
function polyline(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default async function CoursMetauxPage() {
  const session = await getStaffSession();
  if (!session) return null;

  const [{ data: rates }, { data: syncLog }, { data: titles }, { count: repriceable }] =
    await Promise.all([
      session.supabase
        .from("market_rates")
        .select("metal_kind, rate_date, price_eur_per_gram_fine, source")
        .order("rate_date", { ascending: true }),
      session.supabase
        .from("metal_sync_log")
        .select("id, started_at, duration_ms, status, http_status, rates_upserted, triggered_by, error_message")
        .order("started_at", { ascending: false })
        .limit(12),
      session.supabase
        .from("metal_titles")
        .select("metal_kind, purity_per_mille, label")
        .order("metal_kind")
        .order("sort"),
      session.supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .in("status", ["en_stock", "reserve"]),
    ]);

  const series: Record<MetalKind, { date: string; value: number }[]> = {
    or: [],
    argent: [],
    platine: [],
  };
  for (const row of rates ?? []) {
    series[row.metal_kind].push({
      date: row.rate_date,
      value: row.price_eur_per_gram_fine,
    });
  }

  const latest: Partial<Record<MetalKind, { value: number; date: string; source: string }>> = {};
  for (const row of rates ?? []) {
    latest[row.metal_kind] = {
      value: row.price_eur_per_gram_fine,
      date: row.rate_date,
      source: row.source,
    };
  }

  const latestRates: Partial<Record<MetalKind, number>> = {
    or: latest.or?.value,
    argent: latest.argent?.value,
    platine: latest.platine?.value,
  };

  const goldSeries = series.or.slice(-90);
  const silverSeries = series.argent.slice(-90);
  const seedOnly = (rates ?? []).every((r) => r.source === "seed");

  const goldChange =
    goldSeries.length > 7
      ? ((goldSeries.at(-1)!.value - goldSeries.at(-8)!.value) / goldSeries.at(-8)!.value) * 100
      : 0;

  const canSync = session.can(PERMISSIONS.metauxSync);
  const canRecalculate = session.can(PERMISSIONS.metauxRecalculer);

  return (
    <>
      <PageHeader
        breadcrumb={["Maison Piron", "Système", "Cours des métaux"]}
        title="Cours des métaux"
        aside={
          <>
            {canSync && (
              <ActionButton
                action={syncMetalRatesNow}
                className={buttonPrimary}
                pendingLabel="Synchronisation…"
              >
                Forcer une synchronisation
              </ActionButton>
            )}
            {canRecalculate && (
              <ActionButton
                action={recalculatePricesForRateChange}
                className={buttonGhost}
                pendingLabel="Recalcul…"
                confirm={`Recalculer les ${repriceable ?? 0} étiquettes au cours du jour ?`}
              >
                Recalculer les {repriceable ?? 0} étiquettes
              </ActionButton>
            )}
          </>
        }
      />

      <Section>
        <StatRow
          stats={[
            {
              label: "Or fin · 999 ‰",
              value: latest.or ? `${formatEUR(latest.or.value)} /g` : "—",
              sub: latest.or ? `cours du ${latest.or.date} · ${latest.or.source}` : "aucun cours",
            },
            {
              label: "Or 18k · 750 ‰",
              value: latest.or
                ? `${formatEUR(ratePerGramForPurity(latest.or.value, 750))} /g`
                : "—",
              sub: "appliqué aux étiquettes",
            },
            {
              label: "Argent · 925 ‰",
              value: latest.argent
                ? `${formatEUR(ratePerGramForPurity(latest.argent.value, 925))} /g`
                : "—",
              sub: latest.argent ? `cours du ${latest.argent.date}` : "aucun cours",
            },
            {
              label: "Platine · 950 ‰",
              value: latest.platine
                ? `${formatEUR(ratePerGramForPurity(latest.platine.value, 950))} /g`
                : "—",
              sub: latest.platine ? `cours du ${latest.platine.date}` : "à saisir à la main",
            },
          ]}
        />

        {seedOnly && (
          <Notice tone="warning">
            Tous les cours affichés proviennent des données de démonstration
            (<code>source = seed</code>), pas d&apos;un fournisseur réel. Lancez une
            synchronisation pour récupérer les cours du marché — les étiquettes ne
            changeront qu&apos;après un recalcul explicite.
          </Notice>
        )}

        <Card
          title="Or fin et argent · 90 derniers jours"
          subtitle="market_rates · euros par gramme de métal pur"
          aside={
            <div className="flex items-center gap-4 text-[13px] text-mid-gray">
              <span className="flex items-center gap-1">
                <span className="inline-block h-0 w-4 border-t-[1.5px] border-ink" />
                Or
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-0 w-4 border-t-[1.5px] border-dashed border-mid-gray" />
                Argent
              </span>
            </div>
          }
        >
          <div className="flex flex-col gap-2 p-5">
            <svg
              viewBox="0 0 720 220"
              width="100%"
              height="220"
              preserveAspectRatio="none"
              role="img"
              aria-label="Courbe des cours de l'or et de l'argent sur 90 jours"
            >
              {[1, 73, 146].map((y) => (
                <line key={y} x1="0" y1={y} x2="720" y2={y} stroke="#f5f5f5" strokeWidth="1" />
              ))}
              <line x1="0" y1="219" x2="720" y2="219" stroke="#e5e5e5" strokeWidth="1" />
              <polyline
                points={polyline(silverSeries.map((p) => p.value), 720, 220)}
                fill="none"
                stroke="#737373"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={polyline(goldSeries.map((p) => p.value), 720, 220)}
                fill="none"
                stroke="#0a0a0a"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="tabular flex justify-between border-t border-hairline pt-2 text-caption text-mid-gray">
              <span>{goldSeries[0]?.date ?? "—"}</span>
              <span>{goldSeries[Math.floor(goldSeries.length / 2)]?.date ?? ""}</span>
              <span>{goldSeries.at(-1)?.date ?? ""}</span>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-6">
          <Card
            title="Convertisseur"
            subtitle="N'importe quel métal, n'importe quel titre — y compris hors référentiel."
          >
            <RateConverter titles={titles ?? []} rates={latestRates} />
          </Card>

          <div className="flex flex-col gap-6">
            <Card title="Journal de synchronisation" subtitle="Durées réellement mesurées">
              {(syncLog ?? []).length === 0 ? (
                <p className="p-5 text-body text-mid-gray">Aucune synchronisation.</p>
              ) : (
                <div className="flex flex-col">
                  {syncLog!.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid grid-cols-[145px_1fr_auto_auto] items-center gap-4 border-b border-canvas px-5 py-3 last:border-b-0"
                    >
                      <span className="tabular text-[13px] text-mid-gray">
                        {entry.started_at.slice(0, 16).replace("T", " ")}
                      </span>
                      <span className="text-[13px]">
                        {entry.triggered_by === "cron" ? "Cron Vercel" : "Manuel"} ·{" "}
                        {entry.rates_upserted} cours
                        {entry.error_message ? ` · ${entry.error_message}` : ""}
                      </span>
                      <span className="tabular text-[13px] text-mid-gray">
                        {entry.duration_ms ?? 0} ms
                      </span>
                      <Badge tone={entry.status === "echec" ? "danger" : "neutral"}>
                        {entry.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Impact inventaire">
              <div className="flex flex-col gap-3 p-5">
                <p className="text-body text-mid-gray">
                  {goldChange !== 0
                    ? `L'or fin a varié de ${goldChange > 0 ? "+" : ""}${goldChange.toFixed(1)} % sur 7 jours. ${repriceable ?? 0} pièce(s) en stock ou réservée(s) portent encore leur ancien prix.`
                    : `${repriceable ?? 0} pièce(s) sont concernées par un recalcul d'étiquette.`}
                </p>
                <p className="text-caption text-mid-gray">
                  Le recalcul n&apos;est jamais automatique : un cours qui monte ne doit pas
                  changer une étiquette en vitrine sans décision de la maison.
                </p>
                {(Object.keys(METAL_LABELS) as MetalKind[]).map((kind) =>
                  latest[kind] ? null : (
                    <p key={kind} className="text-caption text-ember">
                      Aucun cours pour {METAL_LABELS[kind]} : les pièces concernées ne
                      peuvent pas être vendues tant qu&apos;il manque.
                    </p>
                  ),
                )}
              </div>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
