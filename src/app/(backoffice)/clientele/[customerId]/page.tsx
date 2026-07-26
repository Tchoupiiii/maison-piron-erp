import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { deleteCustomer, updateCustomer, updateCustomerPreferences } from "@/actions/customers";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { RgpdDialog } from "@/components/rgpd-dialog";
import {
  Badge,
  Card,
  Notice,
  PageHeader,
  Section,
  StatRow,
  buttonDanger,
  buttonGhost,
  buttonPrimary,
  inputClass,
  labelClass,
  selectClass,
} from "@/components/ui";
import { formatEUR, REPAIR_COLUMNS } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "@/actions/types";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;

  const { data: customer } = await session.supabase
    .from("customers")
    .select(
      "id, full_name, email, phone, street, postal_code, city, country, lifetime_value, is_privilege, is_anonymized, anonymized_at, customer_since, customer_preferences(ring_size_eu, preferred_metal, preferred_stone, contact_language), customer_consents(granted, recorded_at, expires_at)",
    )
    .eq("id", customerId)
    .maybeSingle();

  if (!customer) notFound();

  const [{ data: sales }, { data: tickets }] = await Promise.all([
    session.supabase
      .from("transactions")
      .select("id, ref, status, total_amount, amount_paid, outstanding_balance, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
    session.supabase
      .from("repair_tickets")
      .select("id, ref, description, status, deadline, estimated_price")
      .eq("customer_id", customerId)
      .order("received_date", { ascending: false }),
  ]);

  // relation 1:1 : PostgREST renvoie un objet, pas un tableau
  const preferences = customer.customer_preferences;
  const consent = customer.customer_consents?.sort((a, b) =>
    b.recorded_at.localeCompare(a.recorded_at),
  )[0];

  const canEdit = session.can(PERMISSIONS.clienteleModifier) && !customer.is_anonymized;
  const canRgpd = session.can(PERMISSIONS.clienteleRgpd);
  const canDelete = session.can(PERMISSIONS.clienteleSupprimer);
  const hasHistory = (sales?.length ?? 0) > 0 || (tickets?.length ?? 0) > 0;

  async function saveCustomer(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return updateCustomer(customerId, {
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      phone: String(formData.get("phone") ?? "") || null,
      street: String(formData.get("street") ?? "") || null,
      postalCode: String(formData.get("postalCode") ?? "") || null,
      city: String(formData.get("city") ?? "") || null,
      isPrivilege: formData.get("isPrivilege") === "on",
    });
  }

  async function savePreferences(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    const ring = formData.get("ringSizeEu");
    return updateCustomerPreferences(customerId, {
      ringSizeEu: ring ? Number(ring) : null,
      preferredMetal:
        (String(formData.get("preferredMetal") ?? "") || null) as
          | "or"
          | "argent"
          | "platine"
          | null,
      preferredStone: String(formData.get("preferredStone") ?? "") || null,
      contactLanguage: String(formData.get("contactLanguage") ?? "fr") as
        | "fr"
        | "nl"
        | "en"
        | "de",
    });
  }

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Clientèle", customer.full_name ?? "Fiche"]}
        title={customer.full_name ?? "Client anonymisé"}
        aside={
          <>
            {customer.is_privilege && <Badge tone="solid">Privilège</Badge>}
            {customer.is_anonymized && <Badge>Anonymisée</Badge>}
            <Link href="/clientele" className={buttonGhost}>
              Retour
            </Link>
          </>
        }
      />

      <Section>
        <StatRow
          stats={[
            { label: "Valeur client", value: formatEUR(customer.lifetime_value), sub: "encaissé" },
            { label: "Achats", value: String(sales?.length ?? 0), sub: "ventes enregistrées" },
            { label: "Réparations", value: String(tickets?.length ?? 0), sub: "passages atelier" },
            { label: "Client depuis", value: customer.customer_since },
          ]}
        />

        {customer.is_anonymized && (
          <Notice>
            Fiche anonymisée le {customer.anonymized_at?.slice(0, 10)}. Les coordonnées
            ont été effacées ; les documents comptables ci-dessous restent conservés
            7 ans (art. 60 CTVA).
          </Notice>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-6">
          <div className="flex flex-col gap-6">
            <Card title="Coordonnées">
              {canEdit ? (
                <ActionForm
                  action={saveCustomer}
                  className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 p-5"
                  successMessage="Fiche enregistrée."
                >
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Nom complet</span>
                    <input name="fullName" defaultValue={customer.full_name ?? ""} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>E-mail</span>
                    <input name="email" type="email" defaultValue={customer.email ?? ""} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Téléphone</span>
                    <input name="phone" defaultValue={customer.phone ?? ""} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Rue</span>
                    <input name="street" defaultValue={customer.street ?? ""} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Code postal</span>
                    <input name="postalCode" defaultValue={customer.postal_code ?? ""} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Ville</span>
                    <input name="city" defaultValue={customer.city ?? ""} className={inputClass} />
                  </label>
                  <label className="flex items-center gap-2 self-end">
                    <input
                      name="isPrivilege"
                      type="checkbox"
                      defaultChecked={customer.is_privilege}
                      className="size-4 accent-ink"
                    />
                    <span className="text-body">Cliente privilège</span>
                  </label>
                  <div className="col-span-full">
                    <button type="submit" className={buttonPrimary}>
                      Enregistrer
                    </button>
                  </div>
                </ActionForm>
              ) : (
                <dl className="grid grid-cols-2 gap-4 p-5 text-body">
                  <div>
                    <dt className={labelClass}>E-mail</dt>
                    <dd>{customer.email ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className={labelClass}>Téléphone</dt>
                    <dd>{customer.phone ?? "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className={labelClass}>Adresse</dt>
                    <dd>
                      {[customer.street, customer.postal_code, customer.city]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </dd>
                  </div>
                </dl>
              )}
            </Card>

            <Card title="Préférences" subtitle={consent ? `Consentement marketing ${consent.granted ? "accordé" : "retiré"}${consent.expires_at ? ` · jusqu'en ${consent.expires_at.slice(0, 4)}` : ""}` : "Aucun consentement enregistré"}>
              {canEdit ? (
                <ActionForm
                  action={savePreferences}
                  className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 p-5"
                  successMessage="Préférences enregistrées."
                >
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Tour de doigt</span>
                    <input
                      name="ringSizeEu"
                      type="number"
                      step="0.5"
                      defaultValue={preferences?.ring_size_eu ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Métal préféré</span>
                    <select
                      name="preferredMetal"
                      defaultValue={preferences?.preferred_metal ?? ""}
                      className={selectClass}
                    >
                      <option value="">—</option>
                      <option value="or">Or</option>
                      <option value="argent">Argent</option>
                      <option value="platine">Platine</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Pierre préférée</span>
                    <input
                      name="preferredStone"
                      defaultValue={preferences?.preferred_stone ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Langue</span>
                    <select
                      name="contactLanguage"
                      defaultValue={preferences?.contact_language ?? "fr"}
                      className={selectClass}
                    >
                      <option value="fr">Français</option>
                      <option value="nl">Nederlands</option>
                      <option value="en">English</option>
                      <option value="de">Deutsch</option>
                    </select>
                  </label>
                  <div className="col-span-full">
                    <button type="submit" className={buttonPrimary}>
                      Enregistrer
                    </button>
                  </div>
                </ActionForm>
              ) : (
                <p className="p-5 text-body text-mid-gray">
                  {preferences
                    ? `Tour ${preferences.ring_size_eu ?? "—"} · ${preferences.preferred_metal ?? "—"} · ${preferences.preferred_stone ?? "—"}`
                    : "Aucune préférence enregistrée."}
                </p>
              )}
            </Card>

            {(canRgpd || canDelete) && !customer.is_anonymized && (
              <Card title="Données personnelles" subtitle="RGPD · articles 17 et 20">
                <div className="flex flex-col gap-4 p-5">
                  {canRgpd && (
                    <RgpdDialog
                      customerId={customerId}
                      customerName={customer.full_name ?? "ce client"}
                    />
                  )}
                  {canDelete && !hasHistory && (
                    <ActionButton
                      action={deleteCustomer.bind(null, customerId)}
                      className={buttonDanger}
                      confirm="Supprimer définitivement cette fiche sans historique ?"
                    >
                      Supprimer la fiche
                    </ActionButton>
                  )}
                  {canDelete && hasHistory && (
                    <p className="text-caption text-mid-gray">
                      Suppression pure impossible : ce client a un historique
                      commercial. L&apos;anonymisation est la voie légale.
                    </p>
                  )}
                </div>
              </Card>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <Card title="Achats" subtitle={`${sales?.length ?? 0} vente(s)`}>
              {(sales ?? []).length === 0 ? (
                <p className="p-5 text-body text-mid-gray">Aucune vente.</p>
              ) : (
                <div className="flex flex-col">
                  {sales!.map((sale) => (
                    <Link
                      key={sale.id}
                      href={`/ventes/${sale.id}`}
                      className="grid grid-cols-[120px_1fr_auto] items-center gap-4 border-b border-canvas px-5 py-3 last:border-b-0 hover:bg-surface-alt"
                    >
                      <span className="tabular text-[13px] text-mid-gray">
                        {sale.ref ?? "brouillon"}
                      </span>
                      <span className="text-[13px] text-mid-gray">
                        {sale.created_at.slice(0, 10)}
                      </span>
                      <span className="tabular text-body">
                        {formatEUR(sale.total_amount)}
                        {sale.outstanding_balance !== null && sale.outstanding_balance > 0 && (
                          <span className="ml-2 text-mid-gray">
                            solde {formatEUR(sale.outstanding_balance)}
                          </span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Réparations" subtitle={`${tickets?.length ?? 0} passage(s) atelier`}>
              {(tickets ?? []).length === 0 ? (
                <p className="p-5 text-body text-mid-gray">Aucune réparation.</p>
              ) : (
                <div className="flex flex-col">
                  {tickets!.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="grid grid-cols-[110px_1fr_auto] items-center gap-4 border-b border-canvas px-5 py-3 last:border-b-0"
                    >
                      <span className="tabular text-[13px] text-mid-gray">{ticket.ref}</span>
                      <span className="text-[13px]">{ticket.description}</span>
                      <span className="text-caption text-mid-gray">
                        {REPAIR_COLUMNS.find((c) => c.key === ticket.status)?.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
