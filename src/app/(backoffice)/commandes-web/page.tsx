import Link from "next/link";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { AccessRestricted } from "@/components/access-restricted";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Section,
  StatRow,
  buttonGhost,
  labelClass,
  selectClass,
} from "@/components/ui";
import { formatEUR } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { Database } from "@/types/database.types";

type WebOrderStatus = Database["public"]["Enums"]["web_order_status"];

const STATUS_LABELS: Record<WebOrderStatus, string> = {
  panier: "Panier en cours",
  en_attente_paiement: "Paiement en cours",
  payee: "Payée",
  echouee: "Échouée",
  expiree: "Expirée",
  remboursee: "Remboursée",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "a-traiter", label: "À traiter" },
  { value: "", label: "Toutes" },
  { value: "payee", label: "Payées" },
  { value: "en_attente_paiement", label: "Paiement en cours" },
  { value: "echouee", label: "Échouées" },
  { value: "remboursee", label: "Remboursées" },
];

const dateFormat = new Intl.DateTimeFormat("fr-BE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function CommandesWebPage({
  searchParams,
}: {
  searchParams: Promise<{ etat?: string }>;
}) {
  const { etat } = await searchParams;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;
  if (!session.can(PERMISSIONS.webCommandes)) {
    return (
      <AccessRestricted
        breadcrumb={[maison.displayName, "Site web", "Commandes"]}
        title="Commandes web"
        permissionLabel="Suivre les commandes en ligne"
      />
    );
  }

  const filter = etat ?? "a-traiter";

  let query = session.supabase
    .from("web_orders")
    .select(
      "id, ref, status, total_ttc, subtotal_ttc, shipping_fee_ttc, fulfilment_mode, contact_name, contact_email, contact_phone, shipping_street, shipping_postal_code, shipping_city, paid_at, failed_reason, refunded_at, created_at, mollie_payment_id, transaction_id, web_order_items(product_id, unit_price_ttc_snapshot, products(name, sku))",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  // Le panier en cours n'est pas une commande : il n'a rien à faire dans une
  // liste de travail. Seul le filtre « Toutes » le montre.
  if (filter === "a-traiter") {
    query = query.in("status", ["payee", "en_attente_paiement", "echouee", "remboursee"]);
  } else if (filter) {
    query = query.eq("status", filter as WebOrderStatus);
  }

  const { data: orders, error } = await query;
  const rows = orders ?? [];

  const paid = rows.filter((o) => o.status === "payee");
  const pending = rows.filter((o) => o.status === "en_attente_paiement");
  const refunded = rows.filter((o) => o.status === "remboursee");
  const revenue = paid.reduce((sum, o) => sum + Number(o.total_ttc), 0);

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Site web", "Commandes"]}
        title="Commandes web"
      />

      <Section>
        <StatRow
          stats={[
            { label: "Payées", value: String(paid.length), sub: "à préparer ou expédier" },
            { label: "En attente", value: String(pending.length), sub: "paiement en cours" },
            { label: "Remboursées", value: String(refunded.length), sub: "pièce indisponible" },
            { label: "Encaissé", value: formatEUR(revenue), sub: "sur la sélection affichée" },
          ]}
        />

        {refunded.length > 0 && (
          <Notice tone="warning">
            Des commandes ont été remboursées : la pièce avait été vendue en boutique pendant
            le paiement en ligne. Vérifiez que le remboursement Mollie est bien passé — le
            message d&apos;échec le précise.
          </Notice>
        )}

        <form className="flex flex-wrap items-end gap-3" action="/commandes-web">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>État</span>
            <select name="etat" defaultValue={filter} className={`${selectClass} w-56`}>
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonGhost}>
            Filtrer
          </button>
        </form>

        {error ? (
          <Card>
            <EmptyState title="Commandes indisponibles" hint={error.message} />
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Aucune commande"
              hint="Les commandes passées sur le site apparaissent ici dès le paiement."
            />
          </Card>
        ) : (
          <Card title={`${rows.length} commande(s)`}>
            <div className="flex flex-col">
              {rows.map((order) => {
                const items = order.web_order_items ?? [];
                const shipped = order.fulfilment_mode === "envoi_belgique";
                return (
                  <div
                    key={order.id}
                    className="flex flex-col gap-2 border-b border-canvas px-5 py-4 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2 text-body font-medium">
                          {order.ref ?? "sans référence"}
                          <Badge tone={order.status === "payee" ? "solid" : order.status === "remboursee" || order.status === "echouee" ? "danger" : "neutral"}>
                            {STATUS_LABELS[order.status]}
                          </Badge>
                          <Badge>{shipped ? "Envoi Belgique" : "Retrait boutique"}</Badge>
                        </span>
                        <span className="text-[13px] text-mid-gray">
                          {order.contact_name ?? "client"} · {order.contact_email ?? "—"}
                          {order.contact_phone ? ` · ${order.contact_phone}` : ""}
                        </span>
                        <span className="tabular text-caption text-mid-gray">
                          {dateFormat.format(new Date(order.paid_at ?? order.created_at))}
                          {order.mollie_payment_id ? ` · Mollie ${order.mollie_payment_id}` : ""}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="tabular text-body">{formatEUR(Number(order.total_ttc))}</span>
                        {order.transaction_id && (
                          <Link
                            href={`/ventes/${order.transaction_id}`}
                            className={`${buttonGhost} h-8 min-h-8 px-3 text-caption`}
                          >
                            Voir la vente
                          </Link>
                        )}
                      </div>
                    </div>

                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                      {items.map((item) => (
                        <li key={item.product_id} className="text-[13px] text-mid-gray">
                          {item.products?.name ?? "Pièce"}
                          {item.products?.sku ? ` · ${item.products.sku}` : ""} ·{" "}
                          {formatEUR(Number(item.unit_price_ttc_snapshot))}
                        </li>
                      ))}
                    </ul>

                    {shipped && order.shipping_street && (
                      <span className="text-[13px] text-mid-gray">
                        Livraison : {order.shipping_street}, {order.shipping_postal_code}{" "}
                        {order.shipping_city} · frais {formatEUR(Number(order.shipping_fee_ttc))}
                      </span>
                    )}

                    {order.failed_reason && (
                      <span className="text-[13px] text-ember">{order.failed_reason}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </Section>
    </>
  );
}
