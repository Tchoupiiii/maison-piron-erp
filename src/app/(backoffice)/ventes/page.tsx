import Link from "next/link";
import { getStaffSession } from "@/actions/auth-guard";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Section,
  StatRow,
  buttonGhost,
  buttonPrimary,
  labelClass,
  selectClass,
} from "@/components/ui";
import { formatEUR, TRANSACTION_STATUS_LABELS } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { Database } from "@/types/database.types";

type TransactionStatus = Database["public"]["Enums"]["transaction_status"];

export default async function VentesPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const { statut } = await searchParams;
  const session = await getStaffSession();
  if (!session) return null;

  let query = session.supabase
    .from("transactions")
    .select(
      "id, ref, status, total_amount, amount_paid, outstanding_balance, issued_at, due_at, created_at, payment_method, customers(full_name), pos_terminals(name)",
    )
    .order("created_at", { ascending: false });

  if (statut) query = query.eq("status", statut as TransactionStatus);

  const { data: sales } = await query;
  const rows = sales ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const encaisse = rows.reduce((sum, s) => sum + s.amount_paid, 0);
  const outstanding = rows.reduce((sum, s) => sum + (s.outstanding_balance ?? 0), 0);
  const overdue = rows.filter(
    (s) => s.due_at && s.due_at < today && (s.outstanding_balance ?? 0) > 0,
  );

  const canSell = session.can(PERMISSIONS.ventesCreer);

  return (
    <>
      <PageHeader
        breadcrumb={["Maison Piron", "Boutique", "Ventes"]}
        title="Ventes & factures"
        aside={
          canSell ? (
            <Link href="/pos" className={buttonPrimary}>
              Encaisser une vente
            </Link>
          ) : undefined
        }
      />

      <Section>
        <StatRow
          stats={[
            { label: "Documents", value: String(rows.length), sub: "tickets et factures" },
            { label: "Encaissé", value: formatEUR(encaisse), sub: "toutes ventes affichées" },
            { label: "Reste dû", value: formatEUR(outstanding), sub: "soldes ouverts" },
            {
              label: "En retard",
              value: String(overdue.length),
              sub: overdue.length > 0 ? "échéances dépassées" : "aucun impayé",
            },
          ]}
        />

        <form className="flex flex-wrap items-end gap-3" action="/ventes">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Statut</span>
            <select name="statut" defaultValue={statut ?? ""} className={`${selectClass} w-52`}>
              <option value="">Tous</option>
              {Object.entries(TRANSACTION_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonGhost}>
            Filtrer
          </button>
        </form>

        <Card>
          {rows.length === 0 ? (
            <EmptyState title="Aucune vente" hint="Les encaissements apparaîtront ici." />
          ) : (
            <div className="flex flex-col">
              {rows.map((sale) => {
                const isOverdue =
                  sale.due_at !== null &&
                  sale.due_at < today &&
                  (sale.outstanding_balance ?? 0) > 0;
                return (
                  <Link
                    key={sale.id}
                    href={`/ventes/${sale.id}`}
                    className="grid grid-cols-[130px_1fr_auto] items-center gap-4 border-b border-canvas px-5 py-4 last:border-b-0 hover:bg-surface-alt"
                  >
                    <span className="tabular text-[13px] text-mid-gray">
                      {sale.ref ?? "brouillon"}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-body font-medium">
                        {sale.customers?.full_name ?? "Client de passage"}
                      </span>
                      <span className="text-caption text-mid-gray">
                        {sale.created_at.slice(0, 10)}
                        {sale.pos_terminals?.name ? ` · ${sale.pos_terminals.name}` : ""}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="tabular text-body">{formatEUR(sale.total_amount)}</span>
                      {isOverdue ? (
                        <Badge tone="danger">Échéance dépassée</Badge>
                      ) : (
                        <Badge>{TRANSACTION_STATUS_LABELS[sale.status]}</Badge>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </Section>
    </>
  );
}
