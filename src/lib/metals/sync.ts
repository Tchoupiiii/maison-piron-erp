import { TROY_OUNCE_GRAMS } from "@/lib/constants";
import type { Database, Json } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

type MetalKind = Database["public"]["Enums"]["metal_kind"];

/** Symboles marché → métaux de l'ERP. */
const SYMBOLS: Record<string, MetalKind> = {
  XAU: "or",
  XAG: "argent",
  XPT: "platine",
};

/**
 * Fournisseur principal : gold-api.com cote en USD par once troy, sans clé ni
 * quota. Le taux USD→EUR vient des références BCE publiées par Frankfurter,
 * également sans clé. Aucun compte à créer, donc aucune coupure de service le
 * jour où un quota gratuit s'épuise.
 */
const GOLD_API = "https://api.gold-api.com/price";
const FX_API = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR";

/** Secours si une clé MetalpriceAPI est configurée. */
const METALPRICE_API = "https://api.metalpriceapi.com/v1/latest";

export type SyncOutcome = {
  status: Database["public"]["Enums"]["sync_status"];
  source: string;
  ratesUpserted: number;
  missing: string[];
  durationMs: number;
  httpStatus: number | null;
  errorMessage: string | null;
  eurPerGram: Partial<Record<MetalKind, number>>;
};

type RateRow = Database["public"]["Tables"]["market_rates"]["Insert"];

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { cache: "no-store" });
  const body = response.ok ? await response.json() : null;
  return { status: response.status, body };
}

async function fromGoldApi(
  rateDate: string,
): Promise<{ rows: RateRow[]; missing: string[]; httpStatus: number }> {
  const fx = await fetchJson(FX_API);
  const eurPerUsd = (fx.body as { rates?: { EUR?: number } } | null)?.rates?.EUR;
  if (!eurPerUsd || !Number.isFinite(eurPerUsd)) {
    throw new Error("Taux de change USD→EUR indisponible");
  }

  const rows: RateRow[] = [];
  const missing: string[] = [];
  let lastStatus = 200;

  for (const [symbol, metalKind] of Object.entries(SYMBOLS)) {
    try {
      const quote = await fetchJson(`${GOLD_API}/${symbol}`);
      lastStatus = quote.status;
      const payload = quote.body as { price?: number; updatedAt?: string } | null;
      const usdPerOunce = payload?.price;

      if (!usdPerOunce || !Number.isFinite(usdPerOunce) || usdPerOunce <= 0) {
        missing.push(symbol);
        continue;
      }

      rows.push({
        metal_kind: metalKind,
        rate_date: rateDate,
        price_eur_per_gram_fine: round4((usdPerOunce * eurPerUsd) / TROY_OUNCE_GRAMS),
        source: "gold-api",
        raw_response: {
          symbol,
          usd_per_ounce: usdPerOunce,
          eur_per_usd: eurPerUsd,
          quoted_at: payload?.updatedAt ?? null,
        } as Json,
      });
    } catch {
      missing.push(symbol);
    }
  }

  return { rows, missing, httpStatus: lastStatus };
}

async function fromMetalpriceApi(
  rateDate: string,
  apiKey: string,
): Promise<{ rows: RateRow[]; missing: string[]; httpStatus: number }> {
  const symbols = Object.keys(SYMBOLS).join(",");
  const { status, body } = await fetchJson(
    `${METALPRICE_API}?api_key=${apiKey}&base=EUR&currencies=${symbols}`,
  );

  const payload = body as {
    success?: boolean;
    rates?: Record<string, number>;
    error?: { message?: string };
  } | null;

  if (!payload || payload.success === false || !payload.rates) {
    throw new Error(payload?.error?.message ?? `MetalpriceAPI a répondu ${status}`);
  }

  const rows: RateRow[] = [];
  const missing: string[] = [];

  for (const [symbol, metalKind] of Object.entries(SYMBOLS)) {
    // base=EUR renvoie EURXAU (onces par euro) ou XAU (euros par once)
    const perOunce =
      payload.rates[`EUR${symbol}`] !== undefined
        ? 1 / payload.rates[`EUR${symbol}`]
        : payload.rates[symbol];

    if (!perOunce || !Number.isFinite(perOunce) || perOunce <= 0) {
      missing.push(symbol);
      continue;
    }

    rows.push({
      metal_kind: metalKind,
      rate_date: rateDate,
      price_eur_per_gram_fine: round4(perOunce / TROY_OUNCE_GRAMS),
      source: "metalpriceapi",
      raw_response: { symbol, eur_per_ounce: perOunce } as Json,
    });
  }

  return { rows, missing, httpStatus: status };
}

/**
 * Récupère les cours et les écrit. `triggeredBy` distingue le Cron Vercel d'une
 * synchronisation lancée à la main depuis l'écran Cours des métaux : le journal
 * affiche l'origine et la durée réellement mesurée.
 */
export async function syncMetalRates(
  supabase: SupabaseClient<Database>,
  triggeredBy: "cron" | "manuel",
): Promise<SyncOutcome> {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const rateDate = new Date().toISOString().slice(0, 10);
  const apiKey = process.env.METALPRICE_API_KEY;

  let rows: RateRow[] = [];
  let missing: string[] = [];
  let httpStatus: number | null = null;
  let source = "gold-api";
  let errorMessage: string | null = null;

  try {
    const primary = await fromGoldApi(rateDate);
    rows = primary.rows;
    missing = primary.missing;
    httpStatus = primary.httpStatus;
    if (rows.length === 0) throw new Error("Aucun cours exploitable");
  } catch (error) {
    errorMessage = (error as Error).message;
    if (apiKey) {
      try {
        const fallback = await fromMetalpriceApi(rateDate, apiKey);
        rows = fallback.rows;
        missing = fallback.missing;
        httpStatus = fallback.httpStatus;
        source = "metalpriceapi";
        errorMessage = `gold-api indisponible (${errorMessage}), bascule sur MetalpriceAPI`;
      } catch (fallbackError) {
        errorMessage = `${errorMessage} · secours : ${(fallbackError as Error).message}`;
      }
    }
  }

  const eurPerGram: Partial<Record<MetalKind, number>> = {};

  if (rows.length > 0) {
    const { error } = await supabase
      .from("market_rates")
      .upsert(rows, { onConflict: "metal_kind,rate_date" });

    if (error) {
      errorMessage = error.message;
      rows = [];
    } else {
      for (const row of rows) {
        eurPerGram[row.metal_kind] = row.price_eur_per_gram_fine;
      }
    }
  }

  const status: Database["public"]["Enums"]["sync_status"] =
    rows.length === 0 ? "echec" : missing.length > 0 ? "partiel" : "succes";

  const durationMs = Date.now() - startedAt;

  await supabase.from("metal_sync_log").insert({
    started_at: startedAtIso,
    finished_at: new Date().toISOString(),
    duration_ms: durationMs,
    status,
    http_status: httpStatus,
    rates_upserted: rows.length,
    triggered_by: triggeredBy,
    error_message:
      status === "succes"
        ? null
        : [errorMessage, missing.length > 0 ? `Cours absents : ${missing.join(", ")}` : null]
            .filter(Boolean)
            .join(" · ") || null,
  });

  return {
    status,
    source,
    ratesUpserted: rows.length,
    missing,
    durationMs,
    httpStatus,
    errorMessage,
    eurPerGram,
  };
}
