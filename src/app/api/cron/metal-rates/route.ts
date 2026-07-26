import { createServiceClient } from "@/lib/supabase/server";
import { syncMetalRates } from "@/lib/metals/sync";
import { generateDailyBrief } from "@/lib/metals/brief";
import { notifyAdmin } from "@/lib/email/resend";

// Le brief NVIDIA (retry + fallback modèle) peut dépasser largement la limite
// par défaut d'une Function Vercel ; la sync des cours reste rapide.
export const maxDuration = 300;

export async function GET(request: Request) {
  // Un secret vide rendrait l'endpoint ouvert à « Bearer  » : on refuse net.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET non configuré", { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Le Cron n'a pas de session : sans clé service_role il ne peut rien écrire.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY non configurée" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const outcome = await syncMetalRates(supabase, "cron");

  // Un cours périmé fige les prix de vente sans que personne ne le voie.
  if (outcome.status !== "succes") {
    await notifyAdmin(
      outcome.status === "echec"
        ? "Échec de synchronisation des cours des métaux"
        : "Synchronisation des cours partielle",
      `<p>${outcome.errorMessage ?? "Cours manquants"} ${
        outcome.missing.length > 0 ? `(${outcome.missing.join(", ")})` : ""
      }</p><p>Les prix affichés reposent sur le dernier cours connu.</p>`,
    );
  }

  // Le brief du matin ne doit jamais faire échouer la synchronisation des cours.
  let brief: { generated: boolean; reason?: string };
  try {
    brief = await generateDailyBrief(supabase);
  } catch (error) {
    brief = { generated: false, reason: error instanceof Error ? error.message : String(error) };
  }

  return Response.json(
    {
      ok: outcome.status !== "echec",
      status: outcome.status,
      source: outcome.source,
      ratesUpserted: outcome.ratesUpserted,
      missing: outcome.missing,
      durationMs: outcome.durationMs,
      brief,
    },
    { status: outcome.status === "echec" ? 502 : 200 },
  );
}
