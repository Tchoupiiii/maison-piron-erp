import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffSession } from "@/actions/auth-guard";
import { PrintButton } from "@/components/print-button";
import { buttonGhost } from "@/components/ui";
import {
  formatEUR,
  INVOICE_LEGAL_NOTICE,
  PAYMENT_METHOD_LABELS,
  VAT_RATE,
} from "@/lib/constants";
import { getMaison } from "@/lib/maison";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  const { transactionId } = await params;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;

  const { data: sale } = await session.supabase
    .from("transactions")
    .select(
      "id, ref, status, total_amount, amount_paid, discount_amount, vat_rate, created_at, issued_at, payment_method, customers(full_name), pos_terminals(name), transaction_items(id, description, quantity, unit_price_ht, line_total_ttc)",
    )
    .eq("id", transactionId)
    .maybeSingle();

  if (!sale) notFound();

  const items = sale.transaction_items ?? [];
  const totalHt = items.reduce(
    (sum, item) => sum + item.unit_price_ht * item.quantity,
    0,
  );
  const vat = Math.round((sale.total_amount - totalHt + sale.discount_amount) * 100) / 100;
  const isInvoice = sale.ref?.startsWith("FA-") ?? false;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* La largeur du ticket suit le gabarit thermique 80 mm. */}
      <style>{`@media print { @page { size: 80mm auto; margin: 4mm; } }`}</style>

      <article className="w-[302px] bg-paper p-5 text-ink print:w-full print:p-0">
        <header className="flex flex-col items-center gap-1 border-b border-dashed border-hairline pb-3 text-center">
          <span className="text-body font-medium">{maison.legalName}</span>
          <span className="text-caption text-mid-gray">
            {maison.street} · {maison.postalCode} {maison.city}
          </span>
          <span className="tabular text-caption text-mid-gray">{maison.vatNumber}</span>
        </header>

        <div className="flex flex-col gap-1 border-b border-dashed border-hairline py-3 text-caption">
          <div className="flex justify-between">
            <span className="text-mid-gray">{isInvoice ? "Facture" : "Ticket"}</span>
            <span className="tabular">{sale.ref ?? "brouillon"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mid-gray">Date</span>
            <span className="tabular">
              {(sale.issued_at ?? sale.created_at).slice(0, 16).replace("T", " ")}
            </span>
          </div>
          {sale.customers?.full_name && (
            <div className="flex justify-between">
              <span className="text-mid-gray">Client</span>
              <span>{sale.customers.full_name}</span>
            </div>
          )}
          {sale.pos_terminals?.name && (
            <div className="flex justify-between">
              <span className="text-mid-gray">Caisse</span>
              <span>{sale.pos_terminals.name}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-b border-dashed border-hairline py-3">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col">
              <span className="text-caption">{item.description}</span>
              <div className="flex justify-between text-caption">
                <span className="tabular text-mid-gray">
                  {item.quantity} × {formatEUR(item.unit_price_ht)} HT
                </span>
                <span className="tabular">{formatEUR(item.line_total_ttc ?? 0)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1 border-b border-dashed border-hairline py-3 text-caption">
          <div className="flex justify-between">
            <span className="text-mid-gray">Total HT</span>
            <span className="tabular">{formatEUR(totalHt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mid-gray">
              TVA {Math.round((sale.vat_rate ?? VAT_RATE) * 100)} %
            </span>
            <span className="tabular">{formatEUR(vat)}</span>
          </div>
          {sale.discount_amount > 0 && (
            <div className="flex justify-between">
              <span className="text-mid-gray">Remise</span>
              <span className="tabular">− {formatEUR(sale.discount_amount)}</span>
            </div>
          )}
          <div className="flex justify-between text-body font-medium">
            <span>Total TTC</span>
            <span className="tabular">{formatEUR(sale.total_amount)}</span>
          </div>
          {sale.payment_method && (
            <div className="flex justify-between">
              <span className="text-mid-gray">Réglé par</span>
              <span>{PAYMENT_METHOD_LABELS[sale.payment_method]}</span>
            </div>
          )}
        </div>

        <footer className="pt-3 text-center text-[10px] leading-[1.4] text-mid-gray">
          {INVOICE_LEGAL_NOTICE}
        </footer>
      </article>

      <div className="flex flex-wrap justify-center gap-2 print:hidden">
        <PrintButton label={isInvoice ? "Imprimer la facture" : "Imprimer le ticket"} />
        <Link href="/pos" className={`${buttonGhost} h-11 min-h-11`}>
          Nouvelle vente
        </Link>
        <Link href={`/ventes/${transactionId}`} className={`${buttonGhost} h-11 min-h-11`}>
          Voir la vente
        </Link>
      </div>
    </div>
  );
}
