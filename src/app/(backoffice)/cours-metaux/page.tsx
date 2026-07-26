import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { syncMetalRatesNow } from "@/actions/metals";
import { recalculatePricesForRateChange } from "@/actions/pricing";
import { ActionButton } from "@/components/action-button";
import { MetalRatesCard } from "@/components/metal-rates-card";
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

export default async function CoursMetauxPage() {
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;

  const [
    { data: rates },
    { data: syncLog },
    { data: titles },
    { data: repriceableIds },
    { data: brief },
  ] = await Promise.all([
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
    session.supabase.rpc("repriceable_product_ids"),
    session.supabase
      .from("daily_market_brief")
      .select("brief_date, body, model, generated_at")
      .order("brief_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const repriceable = repriceableIds?.length ?? 0;

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

  const goldSeries = series.or;
  const silverSeries = series.argent;
  const seedOnly = (rates ?? []).every((r) => r.source === "seed");

  const goldChange =
    goldSeries.length > 7
      ? ((goldSeries.at(-1)!.value - goldSeries.at(-8)!.value) / goldSeries.at(-8)!.value) * 100
      : 0;

  const lastRateDate = (rates ?? []).at(-1)?.rate_date ?? null;
  const briefIsToday = brief?.brief_date === new Date().toISOString().slice(0, 10);

  const canSync = session.can(PERMISSIONS.metauxSync);
  const canRecalculate = session.can(PERMISSIONS.metauxRecalculer);

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Système", "Cours des métaux"]}
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
            {canRecalculate && repriceable > 0 && (
              <ActionButton
                action={recalculatePricesForRateChange}
                className={buttonGhost}
                pendingLabel="Recalcul…"
                confirm={`Recalculer les ${repriceable} étiquettes dont le cours de référence est dépassé ?`}
              >
                Recalculer les {repriceable} étiquettes
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

        <MetalRatesCard
          goldSeries={goldSeries}
          silverSeries={silverSeries}
          goldTitles={(titles ?? []).filter((t) => t.metal_kind === "or")}
          silverTitles={(titles ?? []).filter((t) => t.metal_kind === "argent")}
        />

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

            <Card
              title="Impact inventaire"
              subtitle={
                briefIsToday && brief
                  ? `Brief généré ce matin · ${brief.model}`
                  : undefined
              }
            >
              <div className="flex flex-col gap-3 p-5">
                {briefIsToday && brief ? (
                  <p className="whitespace-pre-line text-body text-ink">{brief.body}</p>
                ) : (
                  <p className="text-body text-mid-gray">
                    {goldChange !== 0
                      ? `L'or fin a varié de ${goldChange > 0 ? "+" : ""}${goldChange.toFixed(1)} % sur 7 jours. `
                      : ""}
                    {repriceable > 0
                      ? `${repriceable} pièce(s) en stock ou réservée(s) ont une étiquette calculée sur un cours antérieur au ${lastRateDate ?? "dernier cours connu"}.`
                      : "Toutes les étiquettes reposent sur le dernier cours connu."}
                  </p>
                )}
                {brief && !briefIsToday && (
                  <p className="text-caption text-mid-gray">
                    Dernier brief : {brief.brief_date} · {brief.model} — le prochain se
                    génère à la synchronisation de 6 h.
                  </p>
                )}
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
