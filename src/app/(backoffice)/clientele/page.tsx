import Link from "next/link";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { createCustomer } from "@/actions/customers";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Section,
  StatRow,
  buttonGhost,
  buttonPrimary,
  inputClass,
  labelClass,
} from "@/components/ui";
import { formatEUR } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "@/actions/types";

export default async function ClientelePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; nouveau?: string }>;
}) {
  const { q, nouveau } = await searchParams;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;

  let query = session.supabase
    .from("customers")
    .select(
      "id, full_name, email, phone, city, lifetime_value, is_privilege, is_anonymized, customer_since",
    )
    .order("full_name");

  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,city.ilike.%${q}%`);

  const { data: customers } = await query;
  const rows = customers ?? [];
  const privilege = rows.filter((c) => c.is_privilege);
  const anonymized = rows.filter((c) => c.is_anonymized);
  const totalValue = rows.reduce((sum, c) => sum + c.lifetime_value, 0);

  const canCreate = session.can(PERMISSIONS.clienteleCreer);
  const showForm = nouveau === "1" && canCreate;

  async function submitCustomer(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return createCustomer({
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      phone: String(formData.get("phone") ?? "") || null,
      street: String(formData.get("street") ?? "") || null,
      postalCode: String(formData.get("postalCode") ?? "") || null,
      city: String(formData.get("city") ?? "") || null,
      isPrivilege: formData.get("isPrivilege") === "on",
    });
  }

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Boutique", "Clientèle"]}
        title="Clientèle"
        aside={
          canCreate ? (
            <Link
              href={showForm ? "/clientele" : "/clientele?nouveau=1"}
              className={showForm ? buttonGhost : buttonPrimary}
            >
              {showForm ? "Fermer" : "Nouveau client"}
            </Link>
          ) : undefined
        }
      />

      <Section>
        <StatRow
          stats={[
            { label: "Fiches", value: String(rows.length), sub: "clients enregistrés" },
            { label: "Privilège", value: String(privilege.length), sub: "clients suivis" },
            { label: "Valeur cumulée", value: formatEUR(totalValue), sub: "encaissé toutes ventes" },
            {
              label: "Anonymisées",
              value: String(anonymized.length),
              sub: "droit à l'effacement exercé",
            },
          ]}
        />

        {showForm && (
          <Card title="Nouveau client">
            <ActionForm
              action={submitCustomer}
              className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 p-5"
              successMessage="Fiche créée."
              resetOnSuccess
            >
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Nom complet</span>
                <input name="fullName" required className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>E-mail</span>
                <input name="email" type="email" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Téléphone</span>
                <input name="phone" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Rue</span>
                <input name="street" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Code postal</span>
                <input name="postalCode" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Ville</span>
                <input name="city" className={inputClass} />
              </label>
              <label className="flex items-center gap-2 self-end">
                <input name="isPrivilege" type="checkbox" className="size-4 accent-ink" />
                <span className="text-body">Cliente privilège</span>
              </label>
              <div className="col-span-full">
                <button type="submit" className={buttonPrimary}>
                  Créer la fiche
                </button>
              </div>
            </ActionForm>
          </Card>
        )}

        <form className="flex flex-wrap items-end gap-3" action="/clientele">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Rechercher</span>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Nom, e-mail ou ville"
              className={`${inputClass} w-72`}
            />
          </label>
          <button type="submit" className={buttonGhost}>
            Filtrer
          </button>
        </form>

        <Card>
          {rows.length === 0 ? (
            <EmptyState title="Aucun client" hint="Ajustez la recherche ou créez une fiche." />
          ) : (
            <div className="flex flex-col">
              {rows.map((customer) => (
                <Link
                  key={customer.id}
                  href={`/clientele/${customer.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-canvas px-5 py-4 last:border-b-0 hover:bg-surface-alt"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 text-body font-medium">
                      {customer.full_name}
                      {customer.is_privilege && <Badge>Privilège</Badge>}
                      {customer.is_anonymized && <Badge>Anonymisée</Badge>}
                    </span>
                    <span className="truncate text-[13px] text-mid-gray">
                      {customer.email ?? "sans e-mail"}
                      {customer.city ? ` · ${customer.city}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular text-body">{formatEUR(customer.lifetime_value)}</span>
                    <span className="text-caption text-mid-gray">
                      client depuis {customer.customer_since}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </Section>
    </>
  );
}
