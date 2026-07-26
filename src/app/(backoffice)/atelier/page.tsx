import Link from "next/link";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { createRepairTicket, updateRepairStatus } from "@/actions/repairs";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  Card,
  PageHeader,
  Section,
  StatRow,
  buttonGhost,
  buttonPrimary,
  inputClass,
  labelClass,
  selectClass,
} from "@/components/ui";
import { formatEUR, REPAIR_COLUMNS } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type RepairStatus = Database["public"]["Enums"]["repair_status"];

const ORDER: RepairStatus[] = ["check_in", "at_bench", "ready", "delivered"];

export default async function AtelierPage({
  searchParams,
}: {
  searchParams: Promise<{ nouveau?: string }>;
}) {
  const { nouveau } = await searchParams;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;

  const today = new Date().toISOString().slice(0, 10);

  const [{ data: tickets }, { data: customers }] = await Promise.all([
    session.supabase
      .from("repair_tickets")
      .select(
        "id, ref, description, status, received_date, deadline, estimated_price, actual_price, customers(id, full_name)",
      )
      .order("deadline", { ascending: true, nullsFirst: false }),
    session.supabase
      .from("customers")
      .select("id, full_name")
      .eq("is_anonymized", false)
      .order("full_name"),
  ]);

  const rows = tickets ?? [];
  const open = rows.filter((t) => t.status !== "delivered");
  const overdue = open.filter((t) => t.deadline && t.deadline < today);
  const ready = rows.filter((t) => t.status === "ready");

  const canCreate = session.can(PERMISSIONS.atelierCreer);
  const canMove = session.can(PERMISSIONS.atelierStatut);
  const showForm = nouveau === "1" && canCreate;

  async function submitTicket(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    const estimated = formData.get("estimatedPrice");
    return createRepairTicket({
      customerId: String(formData.get("customerId") ?? ""),
      description: String(formData.get("description") ?? ""),
      deadline: String(formData.get("deadline") ?? "") || null,
      estimatedPrice: estimated ? Number(estimated) : null,
    });
  }

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Boutique", "Atelier"]}
        title="Atelier"
        aside={
          canCreate ? (
            <Link
              href={showForm ? "/atelier" : "/atelier?nouveau=1"}
              className={showForm ? buttonGhost : buttonPrimary}
            >
              {showForm ? "Fermer" : "Nouvelle prise en charge"}
            </Link>
          ) : undefined
        }
      />

      <Section>
        <StatRow
          stats={[
            { label: "En cours", value: String(open.length), sub: "tickets ouverts" },
            {
              label: "Échéances dépassées",
              value: String(overdue.length),
              sub: overdue.length > 0 ? "à traiter en priorité" : "aucun retard",
            },
            { label: "Prêts à retirer", value: String(ready.length), sub: "clients prévenus" },
            { label: "Total", value: String(rows.length), sub: "toutes réparations" },
          ]}
        />

        {showForm && (
          <Card title="Nouvelle prise en charge" subtitle="Le client reçoit un accusé de réception par e-mail.">
            <ActionForm
              action={submitTicket}
              className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 p-5"
              successMessage="Ticket créé."
              resetOnSuccess
            >
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Client</span>
                <select name="customerId" required className={selectClass}>
                  <option value="">Choisir…</option>
                  {(customers ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Échéance</span>
                <input name="deadline" type="date" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Devis TTC (€)</span>
                <input
                  name="estimatedPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputClass}
                />
              </label>
              <label className="col-span-full flex flex-col gap-1">
                <span className={labelClass}>Intervention</span>
                <textarea
                  name="description"
                  rows={2}
                  required
                  placeholder="Refixation saphir + contrôle serti"
                  className={`${inputClass} h-auto py-2`}
                />
              </label>
              <div className="col-span-full">
                <button type="submit" className={buttonPrimary}>
                  Enregistrer la prise en charge
                </button>
              </div>
            </ActionForm>
          </Card>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-6">
          {REPAIR_COLUMNS.map((column) => {
            const columnTickets = rows.filter((t) => t.status === column.key);
            const index = ORDER.indexOf(column.key);
            const nextStatus = ORDER[index + 1];
            const previousStatus = ORDER[index - 1];

            return (
              <Card
                key={column.key}
                title={column.label}
                subtitle={`${columnTickets.length} ticket(s)`}
              >
                {columnTickets.length === 0 ? (
                  <p className="px-5 py-6 text-[13px] text-mid-gray">Colonne vide.</p>
                ) : (
                  <div className="flex flex-col">
                    {columnTickets.map((ticket) => {
                      const isOverdue =
                        ticket.deadline !== null &&
                        ticket.deadline < today &&
                        ticket.status !== "delivered";
                      return (
                        <div
                          key={ticket.id}
                          className="flex flex-col gap-2 border-b border-canvas px-5 py-4 last:border-b-0"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-body font-medium">
                              {ticket.customers?.full_name ?? "Client"}
                            </span>
                            <span className="tabular text-caption text-mid-gray">
                              {ticket.ref}
                            </span>
                          </div>
                          <p className="text-[13px] text-mid-gray">{ticket.description}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            {isOverdue ? (
                              <Badge tone="danger">Échéance dépassée</Badge>
                            ) : (
                              <span className="text-caption text-mid-gray">
                                {ticket.deadline ? `Échéance ${ticket.deadline}` : "Sans échéance"}
                              </span>
                            )}
                            {ticket.estimated_price !== null && (
                              <span className="tabular text-caption text-mid-gray">
                                {formatEUR(ticket.actual_price ?? ticket.estimated_price)}
                              </span>
                            )}
                          </div>
                          {canMove && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {previousStatus && (
                                <ActionButton
                                  action={updateRepairStatus.bind(null, ticket.id, previousStatus)}
                                  className={`${buttonGhost} h-8 min-h-8 text-[13px]`}
                                >
                                  ← {REPAIR_COLUMNS.find((c) => c.key === previousStatus)?.label}
                                </ActionButton>
                              )}
                              {nextStatus && (
                                <ActionButton
                                  action={updateRepairStatus.bind(null, ticket.id, nextStatus)}
                                  className={`${buttonPrimary} h-8 min-h-8 text-[13px]`}
                                >
                                  {REPAIR_COLUMNS.find((c) => c.key === nextStatus)?.label} →
                                </ActionButton>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </Section>
    </>
  );
}
