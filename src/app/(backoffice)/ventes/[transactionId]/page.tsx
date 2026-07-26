import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { AccessRestricted } from "@/components/access-restricted";
import { emitInvoice, recordPayment, returnSoldItem } from "@/actions/transactions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  Card,
  Notice,
  PageHeader,
  Section,
  StatRow,
  buttonGhost,
  buttonPrimary,
  inputClass,
  labelClass,
} from "@/components/ui";
import {
  formatEUR,
  INVOICE_LEGAL_NOTICE,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_STATUS_LABELS,
} from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "@/actions/types";

export default async function SalePage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  const { transactionId } = await params;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;
  if (!session.can(PERMISSIONS.ventesVoir)) {
    return (
      <AccessRestricted
        breadcrumb={[maison.displayName, "Boutique", "Ventes"]}
        title="Détail de vente"
        permissionLabel="Consulter les ventes"
      />
    );
  }

  const { data: sale } = await session.supabase
    .from("transactions")
    .select(
      "id, ref, status, total_amount, amount_paid, outstanding_balance, discount_amount, vat_rate, issued_at, due_at, sent_at, created_at, payment_method, customers(id, full_name, email, street, postal_code, city, is_anonymized), pos_terminals(name), transaction_items(id, product_id, description, quantity, unit_price_ht, line_total_ht, line_total_ttc)",
    )
    .eq("id", transactionId)
    .maybeSingle();

  if (!sale) notFound();

  // Le ticket imprimable vit dans l'application caisse, déployée à part.
  const posUrl = process.env.NEXT_PUBLIC_POS_URL;
  const canInvoice = session.can(PERMISSIONS.ventesFacturer);
  const canPay = session.can(PERMISSIONS.ventesPaiement);
  const outstanding = sale.outstanding_balance ?? 0;
  // Une note de crédit ne se retourne pas : c'est déjà un retour.
  const isCreditNote = sale.ref?.startsWith("AV-") ?? false;
  const canReturn = session.can(PERMISSIONS.ventesRetour);

  const totalHt = (sale.transaction_items ?? []).reduce(
    (sum, item) => sum + (item.line_total_ht ?? 0),
    0,
  );

  async function submitPayment(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return recordPayment(transactionId, Number(formData.get("amount") ?? 0));
  }

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Ventes", sale.ref ?? "Brouillon"]}
        title={sale.ref ?? "Vente en brouillon"}
        aside={
          <>
            <Badge tone={sale.status === "payee" ? "solid" : "neutral"}>
              {TRANSACTION_STATUS_LABELS[sale.status]}
            </Badge>
            <Link href="/ventes" className={buttonGhost}>
              Retour
            </Link>
          </>
        }
      />

      <Section>
        <StatRow
          stats={[
            { label: "Total TTC", value: formatEUR(sale.total_amount) },
            { label: "Encaissé", value: formatEUR(sale.amount_paid) },
            { label: "Reste dû", value: formatEUR(outstanding) },
            {
              label: "Échéance",
              value: sale.due_at ?? "—",
              sub: sale.sent_at ? "facture envoyée" : "non envoyée",
            },
          ]}
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-6">
          <Card
            title="Lignes"
            subtitle={`${sale.transaction_items?.length ?? 0} ligne(s) · TVA ${Math.round(sale.vat_rate * 100)} %`}
          >
            <div className="flex flex-col">
              {(sale.transaction_items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-canvas px-5 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body">{item.description}</span>
                    <span className="text-caption text-mid-gray">
                      {item.quantity} × {formatEUR(item.unit_price_ht)} HT
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular text-body">
                      {formatEUR(item.line_total_ttc ?? 0)}
                    </span>
                    {canReturn && item.product_id && !isCreditNote && (
                      <ActionButton
                        action={returnSoldItem.bind(null, item.id, "Retour client")}
                        className={`${buttonGhost} h-8 min-h-8 text-[13px]`}
                        confirm={`Enregistrer le retour de « ${item.description} » ? Une note de crédit sera émise et la pièce redeviendra vendable, en boutique comme en ligne. La vente d'origine, elle, est conservée.`}
                      >
                        Retour
                      </ActionButton>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex flex-col gap-1 px-5 py-4 text-body">
                <div className="flex justify-between">
                  <span className="text-mid-gray">Total HT</span>
                  <span className="tabular">{formatEUR(totalHt)}</span>
                </div>
                {sale.discount_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-mid-gray">Remise</span>
                    <span className="tabular">− {formatEUR(sale.discount_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <span>Total TTC</span>
                  <span className="tabular">{formatEUR(sale.total_amount)}</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-6">
            <Card title="Client">
              <div className="flex flex-col gap-2 p-5 text-body">
                {sale.customers ? (
                  <>
                    <Link
                      href={`/clientele/${sale.customers.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {sale.customers.full_name}
                    </Link>
                    <span className="text-mid-gray">
                      {[sale.customers.street, sale.customers.postal_code, sale.customers.city]
                        .filter(Boolean)
                        .join(", ") || "adresse non renseignée"}
                    </span>
                    <span className="text-mid-gray">{sale.customers.email ?? "—"}</span>
                  </>
                ) : (
                  <span className="text-mid-gray">
                    Client de passage · ticket de caisse sans identification
                  </span>
                )}
                {sale.payment_method && (
                  <span className="text-mid-gray">
                    Règlement : {PAYMENT_METHOD_LABELS[sale.payment_method]}
                  </span>
                )}
                {sale.pos_terminals?.name && (
                  <span className="text-caption text-mid-gray">
                    Encaissé sur {sale.pos_terminals.name}
                  </span>
                )}
              </div>
            </Card>

            <Card title="Actions">
              <div className="flex flex-col gap-4 p-5">
                {sale.status === "brouillon" && canInvoice && (
                  <ActionButton
                    action={emitInvoice.bind(null, transactionId)}
                    className={buttonPrimary}
                  >
                    Émettre la facture
                  </ActionButton>
                )}

                {sale.status === "brouillon" && !sale.customers && (
                  <Notice>
                    Une facture nominative exige un client identifié. Rattachez une fiche
                    client avant l&apos;émission.
                  </Notice>
                )}

                {outstanding > 0 && sale.status !== "brouillon" && canPay && (
                  <ActionForm
                    action={submitPayment}
                    className="flex flex-wrap items-end gap-3"
                    successMessage="Règlement enregistré."
                  >
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Règlement (€)</span>
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={outstanding}
                        defaultValue={outstanding.toFixed(2)}
                        className={`${inputClass} w-40`}
                      />
                    </label>
                    <button type="submit" className={buttonPrimary}>
                      Enregistrer
                    </button>
                  </ActionForm>
                )}

                {outstanding === 0 && sale.status !== "brouillon" && (
                  <p className="text-body text-mid-gray">Vente intégralement réglée.</p>
                )}

                {posUrl && (
                  <a
                    href={`${posUrl}/ticket/${transactionId}`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonGhost}
                  >
                    Voir le ticket imprimable ↗
                  </a>
                )}
              </div>
            </Card>

            <Card title="Mentions légales">
              <div className="flex flex-col gap-2 p-5 text-caption text-mid-gray">
                <span>
                  {maison.legalName}, {maison.street}, {maison.postalCode} {maison.city} ·{" "}
                  {maison.vatNumber}
                </span>
                <span>{INVOICE_LEGAL_NOTICE}</span>
              </div>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
