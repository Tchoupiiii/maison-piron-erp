import { createServiceClient } from "@/lib/supabase/server";

/**
 * Libération des réservations boutique expirées, et nettoyage des commandes
 * web dont le paiement a été abandonné.
 *
 * Le panier web ne retient plus aucune pièce (voir la migration
 * `panier_web_sans_reservation`) : seul un scan en boutique pose encore une
 * réservation, purgée à chaque scan et à chaque encaissement. Ce passage
 * régulier couvre le cas où la boutique est fermée et où personne ne scanne
 * plus pour déclencher ce nettoyage.
 *
 * La fonction est idempotente et ne touche que les réservations dont
 * l'échéance est dépassée.
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

  // Une session de paiement abandonnée depuis plus de 30 minutes ne reprendra
  // pas : on referme la commande pour qu'elle sorte de la liste de travail.
  // Un simple panier ('panier') ne retient aucune pièce : il peut vivre
  // indéfiniment sans conséquence sur le stock, rien à expirer ici.
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { error: expireError } = await supabase
    .from("web_orders")
    .update({ status: "expiree", failed_reason: "Paiement abandonné" })
    .eq("status", "en_attente_paiement")
    .lt("updated_at", staleBefore)
    .is("transaction_id", null);

  return Response.json({
    ok: !expireError,
    released: released ?? 0,
    ordersError: expireError?.message ?? null,
  });
}
