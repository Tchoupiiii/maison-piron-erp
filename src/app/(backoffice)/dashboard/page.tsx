import { createClient } from "@/lib/supabase/server";
import { formatEUR, PRODUCT_STATUS_LABELS, REPAIR_COLUMNS } from "@/lib/constants";
import { ratePerGramForPurity } from "@/lib/pricing/engine";

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [products, tickets, sales, goldRate, lastSync] = await Promise.all([
    supabase.from("products").select("id, name, sku, status, cached_ttc, showcase_slot"),
    supabase
      .from("repair_tickets")
      .select("id, ref, description, status, deadline, estimated_price, customers(full_name)")
      .neq("status", "delivered")
      .order("deadline", { ascending: true }),
    supabase
      .from("transactions")
      .select("ref, total_amount, amount_paid, outstanding_balance, status, customers(full_name)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("market_rates")
      .select("price_eur_per_gram_fine, rate_date")
      .eq("metal_kind", "or")
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("metal_sync_log")
      .select("status, started_at, duration_ms")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const gold = goldRate.data;
  const inStock = products.data?.filter((p) => p.status === "en_stock") ?? [];
  const reserved = products.data?.filter((p) => p.status === "reserve") ?? [];
  const openTickets = tickets.data ?? [];
  const overdue = openTickets.filter((t) => t.deadline && t.deadline < today);
  const monthRevenue = (sales.data ?? []).reduce((s, t) => s + t.amount_paid, 0);

  const stats = [
    {
      label: "Vitrine active",
      value: String(inStock.length),
      sub: `${reserved.length} pièce(s) réservée(s) · ${openTickets.length} en atelier`,
    },
    {
      label: "Encaissé (5 dernières)",
      value: formatEUR(monthRevenue),
      sub: `${sales.data?.length ?? 0} factures récentes`,
    },
    {
      label: "Or 18k du jour",
      value: gold
        ? formatEUR(ratePerGramForPurity(gold.price_eur_per_gram_fine, 750))
        : "—",
      sub: gold ? `par gramme · cours du ${gold.rate_date}` : "aucun cours",
    },
    {
      label: "Échéances atelier",
      value: String(overdue.length),
      sub: overdue.length > 0 ? "dépassée(s)" : "aucun retard",
    },
  ];

  return (
    <>
      <header className="sticky top-0 z-10 flex items-end justify-between gap-6 border-b border-hairline bg-canvas px-12 pb-5 pt-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[14px] text-mid-gray">
            <span>Maison Piron</span>
            <span>›</span>
            <span>Boutique</span>
            <span>›</span>
            <span className="text-ink">Aujourd&apos;hui</span>
          </div>
          <h1 className="text-[30px] font-semibold leading-[1.2] tracking-[-0.75px]">
            Tableau de bord
          </h1>
        </div>
        <span className="text-[12px] uppercase tracking-[0.6px] text-mid-gray">
          {lastSync.data
            ? `Sync ${lastSync.data.status} · ${lastSync.data.duration_ms ?? 0} ms`
            : "Aucune synchronisation"}
        </span>
      </header>

      <section className="flex flex-col gap-12 px-12 pb-12 pt-6">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-12 border-b border-hairline pb-6">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1">
              <span className="text-[12px] uppercase tracking-[0.6px] text-mid-gray">
                {s.label}
              </span>
              <span className="tabular text-[36px] font-medium leading-[1.11] tracking-[-0.9px]">
                {s.value}
              </span>
              <span className="text-[13px] text-mid-gray">{s.sub}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-6">
          <div className="overflow-hidden rounded-[24px] border border-hairline bg-paper shadow-card">
            <div className="border-b border-hairline px-5 py-4">
              <span className="text-[18px] font-medium leading-[1.56]">Atelier</span>
              <p className="text-[13px] text-mid-gray">
                {openTickets.length} ticket(s) en cours
              </p>
            </div>
            {openTickets.map((t) => {
              const isOverdue = t.deadline !== null && t.deadline < today;
              return (
                <div
                  key={t.id}
                  className="grid grid-cols-[1fr_auto] gap-4 border-b border-canvas px-5 py-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[14px] font-medium">
                      {t.customers?.full_name ?? "Client"}
                    </span>
                    <span className="text-[13px] leading-[1.43] text-mid-gray">
                      {t.description}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular text-[12px] text-mid-gray">{t.ref}</span>
                    <span
                      className={`text-[12px] font-medium ${isOverdue ? "text-ember" : "text-mid-gray"}`}
                    >
                      {isOverdue ? "Échéance dépassée" : `Échéance ${t.deadline ?? "—"}`}
                    </span>
                    <span className="text-[12px] text-mid-gray">
                      {REPAIR_COLUMNS.find((c) => c.key === t.status)?.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-6">
            <div className="overflow-hidden rounded-[24px] border border-hairline bg-paper shadow-card">
              <div className="border-b border-hairline px-5 py-4 text-[12px] uppercase tracking-[0.6px] text-mid-gray">
                Dernières factures
              </div>
              {(sales.data ?? []).map((s) => (
                <div
                  key={s.ref}
                  className="grid grid-cols-[110px_1fr_auto] items-center gap-4 border-b border-canvas px-5 py-3"
                >
                  <span className="tabular text-[13px] text-mid-gray">{s.ref}</span>
                  <span className="text-[14px]">{s.customers?.full_name}</span>
                  <span className="tabular text-[13px]">
                    {formatEUR(s.total_amount)}
                    {s.outstanding_balance !== null && s.outstanding_balance > 0 && (
                      <span className="ml-2 text-mid-gray">
                        solde {formatEUR(s.outstanding_balance)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-4">
              <span className="text-[24px] font-semibold leading-[1.33] tracking-[-0.6px]">
                Vitrine
              </span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
                {(products.data ?? [])
                  .filter((p) => p.status !== "vendu")
                  .map((p) => (
                    <div key={p.id} className="flex flex-col gap-3">
                      <div className="relative grid aspect-[4/5] place-items-center rounded-[24px] border border-hairline bg-paper shadow-card">
                        <span className="tabular text-[12px] tracking-[0.6px] text-mid-gray">
                          {p.showcase_slot ?? p.sku}
                        </span>
                        <span className="absolute right-3 top-3 rounded-[18px] bg-ink-soft px-2 py-0.5 text-[12px] font-medium text-surface-alt">
                          {PRODUCT_STATUS_LABELS[p.status]}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[14px] font-medium">{p.name}</span>
                        <span className="tabular text-[13px] text-mid-gray">
                          {p.cached_ttc !== null ? formatEUR(p.cached_ttc) : "prix à calculer"}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
