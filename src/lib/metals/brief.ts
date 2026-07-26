import { completeText } from "@/lib/llm/nvidia";
import { METAL_LABELS } from "@/lib/constants";
import type { Database } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

type MetalKind = Database["public"]["Enums"]["metal_kind"];

const SYSTEM_PROMPT =
  "Tu rédiges un point du matin pour l'équipe d'une bijouterie belge (Maison Piron). " +
  "Style sobre, factuel, 3 à 4 phrases en français, aucune mise en forme markdown. " +
  "Tu ne donnes jamais de conseil d'investissement ni de prédiction de cours. " +
  "Le recalcul des étiquettes reste toujours une décision humaine, jamais automatique : " +
  "rappelle-le si pertinent. N'utilise que les chiffres fournis, n'en invente aucun.";

/**
 * Génère et upsert le brief du jour à partir des vrais chiffres de la base.
 * N'écrit rien et ne lève jamais si NVIDIA_API_KEY est absente ou si l'appel
 * échoue : le cron qui synchronise les cours ne doit jamais dépendre de l'IA.
 */
export async function generateDailyBrief(
  supabase: SupabaseClient<Database>,
): Promise<{ generated: boolean; reason?: string }> {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: rates }, { data: repriceableIds }, { count: totalStock }] = await Promise.all([
    supabase
      .from("market_rates")
      .select("metal_kind, rate_date, price_eur_per_gram_fine")
      .order("rate_date", { ascending: true })
      .limit(3 * 30),
    supabase.rpc("repriceable_product_ids"),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .in("status", ["en_stock", "reserve"]),
  ]);

  const series: Partial<Record<MetalKind, { date: string; value: number }[]>> = {};
  for (const row of rates ?? []) {
    (series[row.metal_kind] ??= []).push({ date: row.rate_date, value: row.price_eur_per_gram_fine });
  }

  const changes: string[] = [];
  for (const kind of Object.keys(METAL_LABELS) as MetalKind[]) {
    const values = series[kind];
    if (!values || values.length < 2) continue;
    const last = values.at(-1)!;
    const weekAgo = values.length > 7 ? values.at(-8)! : values[0];
    const pct = ((last.value - weekAgo.value) / weekAgo.value) * 100;
    changes.push(
      `${METAL_LABELS[kind]} : ${last.value.toFixed(2)} €/g au ${last.date} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)} % sur 7 jours)`,
    );
  }

  const repriceable = repriceableIds?.length ?? 0;

  if (changes.length === 0) {
    return { generated: false, reason: "Aucun cours disponible" };
  }

  const sourceData = {
    date: today,
    changes,
    repriceable,
    totalStock: totalStock ?? 0,
  };

  const prompt =
    `Cours du jour :\n${changes.join("\n")}\n\n` +
    `Stock : ${totalStock ?? 0} pièce(s) en stock ou réservée(s), dont ${repriceable} ` +
    `dont l'étiquette repose sur un cours antérieur au dernier cours connu.\n\n` +
    `Rédige le point du matin.`;

  const result = await completeText({ system: SYSTEM_PROMPT, prompt });
  if (!result) {
    return { generated: false, reason: "NVIDIA Build indisponible ou clé absente" };
  }

  const { error } = await supabase.from("daily_market_brief").upsert(
    {
      brief_date: today,
      body: result.text,
      model: result.model,
      source_data: sourceData,
    },
    { onConflict: "brief_date" },
  );

  if (error) return { generated: false, reason: error.message };

  return { generated: true };
}
