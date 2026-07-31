import { createServiceClient } from "@/lib/supabase/server";

/**
 * Libération des réservations expirées.
 *
 * `release_expired_holds()` est déjà appelée à chaque scan et à chaque
 * encaissement : en boutique seule, aucune pièce ne restait bloquée longtemps.
 * Le site change la donne — un panier abandonné à 23 h retiendrait sa pièce
 * jusqu'au premier scan du lendemain matin, invisible en vitrine.
 *
 * D'où ce passage régulier. La fonction est idempotente et ne touche que les
 * réservations dont l'échéance est dépassée.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET non configuré", { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY non configurée" }, { status: 503 });
  }

  const supabase = createServiceClient();

  // `release_expired_holds` n'a aucun grant, pas même à `authenticated` : elle
  // n'est appelable que par le propriétaire des fonctions. La clé service_role
  // passe, et c'est le seul chemin voulu.
  const { data: released, error } = await supabase.rpc("release_expired_holds");
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 502 });
  }

  // Un panier web dont les pièces sont reparties n'a plus lieu d'attendre un
  // paiement : on le classe pour qu'il sorte de la liste de travail.
  const { error: expireError } = await supabase
    .from("web_orders")
    .update({ status: "expiree", failed_reason: "Réservation expirée" })
    .in("status", ["panier", "en_attente_paiement"])
    .lt("expires_at", new Date().toISOString())
    .is("transaction_id", null);

  return Response.json({
    ok: !expireError,
    released: released ?? 0,
    ordersError: expireError?.message ?? null,
  });
}
