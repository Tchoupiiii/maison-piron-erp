import Link from "next/link";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { setEnquiryStatus, setEnquiryStatusForm } from "@/actions/web-orders";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { AccessRestricted } from "@/components/access-restricted";
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
  selectClass,
} from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import type { Database } from "@/types/database.types";

type EnquiryStatus = Database["public"]["Enums"]["enquiry_status"];

const KIND_LABELS: Record<string, string> = {
  rendez_vous: "Rendez-vous",
  question: "Question",
  estimation: "Estimation",
  autre: "Autre",
};

const STATUS_LABELS: Record<EnquiryStatus, string> = {
  nouvelle: "Nouvelle",
  en_cours: "En cours",
  traitee: "Traitée",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "ouvertes", label: "À traiter" },
  { value: "", label: "Toutes" },
  { value: "nouvelle", label: "Nouvelles" },
  { value: "en_cours", label: "En cours" },
  { value: "traitee", label: "Traitées" },
];

const dateFormat = new Intl.DateTimeFormat("fr-BE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function DemandesPage({
  searchParams,
}: {
  searchParams: Promise<{ etat?: string }>;
}) {
  const { etat } = await searchParams;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;
  if (!session.can(PERMISSIONS.webDemandes)) {
    return (
      <AccessRestricted
        breadcrumb={[maison.displayName, "Site web", "Demandes"]}
        title="Demandes"
        permissionLabel="Traiter les demandes du site"
      />
    );
  }

  const filter = etat ?? "ouvertes";

  let query = session.supabase
    .from("web_enquiries")
    .select(
      "id, kind, full_name, email, phone, subject, message, status, created_at, handled_at, handled_note, product_id, products(name, sku, web_slug), staff_profiles(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "ouvertes") query = query.in("status", ["nouvelle", "en_cours"]);
  else if (filter) query = query.eq("status", filter as EnquiryStatus);

  const { data: enquiries, error } = await query;
  const rows = enquiries ?? [];

  return (
    <>
      <PageHeader breadcrumb={[maison.displayName, "Site web", "Demandes"]} title="Demandes" />

      <Section>
        <StatRow
          stats={[
            {
              label: "Nouvelles",
              value: String(rows.filter((e) => e.status === "nouvelle").length),
              sub: "jamais ouvertes",
            },
            {
              label: "En cours",
              value: String(rows.filter((e) => e.status === "en_cours").length),
              sub: "prises en charge",
            },
            {
              label: "Rendez-vous",
              value: String(rows.filter((e) => e.kind === "rendez_vous").length),
              sub: "sur la sélection",
            },
            { label: "Total affiché", value: String(rows.length) },
          ]}
        />

        <form className="flex flex-wrap items-end gap-3" action="/demandes">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>État</span>
            <select name="etat" defaultValue={filter} className={`${selectClass} w-48`}>
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
            <EmptyState title="Demandes indisponibles" hint={error.message} />
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Aucune demande"
              hint="Les messages envoyés depuis le site arrivent ici."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((enquiry) => (
              <Card
                key={enquiry.id}
                title={enquiry.full_name}
                subtitle={`${enquiry.email}${enquiry.phone ? ` · ${enquiry.phone}` : ""} · ${dateFormat.format(new Date(enquiry.created_at))}`}
                aside={
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{KIND_LABELS[enquiry.kind] ?? enquiry.kind}</Badge>
                    <Badge tone={enquiry.status === "traitee" ? "neutral" : "solid"}>
                      {STATUS_LABELS[enquiry.status]}
                    </Badge>
                  </div>
                }
              >
                <div className="flex flex-col gap-3 p-5">
                  {enquiry.subject && (
                    <span className="text-body font-medium">{enquiry.subject}</span>
                  )}
                  <p className="whitespace-pre-line text-body text-mid-gray">{enquiry.message}</p>

                  {enquiry.products && (
                    <span className="text-caption text-mid-gray">
                      Au sujet de{" "}
                      <Link
                        href={`/inventaire/${enquiry.product_id}`}
                        className="text-ink underline underline-offset-2"
                      >
                        {enquiry.products.name} · {enquiry.products.sku}
                      </Link>
                    </span>
                  )}

                  {enquiry.handled_note && (
                    <span className="text-caption text-mid-gray">
                      Note : {enquiry.handled_note}
                    </span>
                  )}

                  {enquiry.handled_at && (
                    <span className="text-caption text-mid-gray">
                      Traitée le {dateFormat.format(new Date(enquiry.handled_at))}
                      {enquiry.staff_profiles?.full_name
                        ? ` par ${enquiry.staff_profiles.full_name}`
                        : ""}
                    </span>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`mailto:${enquiry.email}?subject=${encodeURIComponent(
                        `Votre message à ${maison.displayName}`,
                      )}`}
                      className={`${buttonGhost} h-8 min-h-8 px-3 text-caption`}
                    >
                      Répondre par e-mail
                    </a>
                    {enquiry.status !== "en_cours" && (
                      <ActionButton
                        action={setEnquiryStatus.bind(null, enquiry.id, "en_cours", undefined)}
                        className={`${buttonGhost} h-8 min-h-8 px-3 text-caption`}
                      >
                        Prendre en charge
                      </ActionButton>
                    )}
                    {enquiry.status !== "nouvelle" && (
                      <ActionButton
                        action={setEnquiryStatus.bind(null, enquiry.id, "nouvelle", undefined)}
                        className={`${buttonGhost} h-8 min-h-8 px-3 text-caption`}
                      >
                        Rouvrir
                      </ActionButton>
                    )}
                  </div>

                  {enquiry.status !== "traitee" && (
                    <details className="rounded-card border border-hairline bg-surface-alt">
                      <summary className="cursor-pointer px-3 py-2 text-caption text-mid-gray">
                        Clôturer avec une note
                      </summary>
                      <ActionForm
                        action={setEnquiryStatusForm.bind(null, enquiry.id)}
                        className="flex flex-col gap-3 p-3"
                        successMessage="Demande clôturée."
                      >
                        <input type="hidden" name="status" value="traitee" />
                        <label className="flex flex-col gap-1">
                          <span className={labelClass}>Ce qui a été fait</span>
                          <input
                            name="note"
                            placeholder="Rendez-vous fixé au 12/08, 14h"
                            className={inputClass}
                          />
                        </label>
                        <button type="submit" className={buttonPrimary}>
                          Marquer traitée
                        </button>
                      </ActionForm>
                    </details>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
