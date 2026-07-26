import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffSession } from "@/actions/auth-guard";
import {
  createStaffAccount,
  deleteStaffAccount,
  revokeStaffSessions,
  setStaffActive,
  setStaffRole,
  updateStaffIdentity,
} from "@/actions/staff";
import { createTerminal, updateTerminal, updateTerminalForm } from "@/actions/terminals";
import { updateMaisonSettings } from "@/actions/maison";
import { getMaison } from "@/lib/maison";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import {
  RolePermissionMatrix,
  StaffPermissionPanel,
} from "@/components/permission-matrix";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Section,
  buttonDanger,
  buttonGhost,
  buttonPrimary,
  inputClass,
  labelClass,
  selectClass,
} from "@/components/ui";
import { ACTIVITY_LABELS, PERMISSIONS, STAFF_ROLE_LABELS } from "@/lib/permissions";
import type { ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type StaffRole = Database["public"]["Enums"]["staff_role"];

const TABS = [
  { key: "employes", label: "Employés" },
  { key: "permissions", label: "Permissions" },
  { key: "caisses", label: "Caisses" },
  { key: "maison", label: "Maison" },
  { key: "journal", label: "Journal d'activité" },
  { key: "sessions", label: "Sessions actives" },
] as const;

export default async function ReglagesPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string; acteur?: string; action?: string }>;
}) {
  const { onglet, acteur, action } = await searchParams;
  const session = await getStaffSession();
  if (!session) return null;

  if (!session.can(PERMISSIONS.systemeEmployes) && !session.can(PERMISSIONS.systemeJournal)) {
    notFound();
  }

  const tab = TABS.find((t) => t.key === onglet)?.key ?? "employes";

  const { data: staff } = await session.supabase
    .from("staff_profiles")
    .select("id, full_name, username, email, role, is_active, created_at, deactivated_at")
    .order("full_name");

  async function submitStaff(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return createStaffAccount({
      username: String(formData.get("username") ?? ""),
      email: String(formData.get("email") ?? ""),
      fullName: String(formData.get("fullName") ?? ""),
      role: String(formData.get("role") ?? "vendeuse") as StaffRole,
      password: String(formData.get("password") ?? ""),
    });
  }

  async function submitTerminal(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return createTerminal({
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      location: String(formData.get("location") ?? "") || null,
      receiptFormat: String(formData.get("receiptFormat") ?? "thermique_80") as
        | "thermique_80"
        | "thermique_58"
        | "a4",
      scannerMode: String(formData.get("scannerMode") ?? "clavier") as
        | "clavier"
        | "camera"
        | "rfid",
    });
  }

  const maison = await getMaison();

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Système", "Réglages"]}
        title="Réglages"
      />

      <Section>
        <nav className="flex flex-wrap gap-2 border-b border-hairline pb-4">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/reglages?onglet=${t.key}`}
              className={t.key === tab ? buttonPrimary : buttonGhost}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {tab === "employes" && (
          <EmployeesTab staff={staff ?? []} session={session} submitStaff={submitStaff} />
        )}
        {tab === "permissions" && <PermissionsTab session={session} staff={staff ?? []} />}
        {tab === "caisses" && <TerminalsTab session={session} submitTerminal={submitTerminal} />}
        {tab === "maison" && <MaisonTab session={session} />}
        {tab === "journal" && (
          <ActivityTab session={session} acteur={acteur} action={action} staff={staff ?? []} />
        )}
        {tab === "sessions" && <SessionsTab session={session} />}
      </Section>
    </>
  );
}

type Session = NonNullable<Awaited<ReturnType<typeof getStaffSession>>>;
type StaffRow = {
  id: string;
  full_name: string;
  username: string | null;
  email: string | null;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  deactivated_at: string | null;
};

async function EmployeesTab({
  staff,
  session,
  submitStaff,
}: {
  staff: StaffRow[];
  session: Session;
  submitStaff: (formData: FormData) => Promise<ActionResult<unknown>>;
}) {
  const canManage = session.can(PERMISSIONS.systemeEmployes);
  const serviceKeyMissing = !process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Équipe" subtitle={`${staff.length} compte(s)`}>
        <div className="flex flex-col">
          {staff.map((person) => (
            <div key={person.id} className="border-b border-canvas last:border-b-0">
              <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2 text-body font-medium">
                    {person.full_name}
                    <Badge tone={person.role === "admin" ? "solid" : "neutral"}>
                      {STAFF_ROLE_LABELS[person.role]}
                    </Badge>
                    {!person.is_active && <Badge tone="danger">Désactivé</Badge>}
                    {person.id === session.userId && <Badge>Vous</Badge>}
                  </span>
                  <span className="truncate text-[13px] text-mid-gray">
                    {person.username
                      ? `identifiant ${person.username}${person.email ? ` · ${person.email}` : ""}`
                      : (person.email ?? "identifiant inconnu")}
                  </span>
                </div>

                {canManage && person.id !== session.userId && (
                  <div className="flex flex-wrap items-center gap-2">
                    {(["admin", "gemmologue", "vendeuse"] as StaffRole[])
                      .filter((role) => role !== person.role)
                      .map((role) => (
                        <ActionButton
                          key={role}
                          action={setStaffRole.bind(null, person.id, role)}
                          className={`${buttonGhost} h-8 min-h-8 text-[13px]`}
                        >
                          → {STAFF_ROLE_LABELS[role]}
                        </ActionButton>
                      ))}
                    <ActionButton
                      action={revokeStaffSessions.bind(null, person.id)}
                      className={`${buttonGhost} h-8 min-h-8 text-[13px]`}
                    >
                      Déconnecter
                    </ActionButton>
                    <ActionButton
                      action={setStaffActive.bind(null, person.id, !person.is_active)}
                      className={`${buttonGhost} h-8 min-h-8 text-[13px]`}
                    >
                      {person.is_active ? "Désactiver" : "Réactiver"}
                    </ActionButton>
                    <ActionButton
                      action={deleteStaffAccount.bind(null, person.id)}
                      className={`${buttonDanger} h-8 min-h-8 text-[13px]`}
                      confirm={`Supprimer définitivement le compte de ${person.full_name} ? La désactivation conserve l'historique et coupe l'accès tout aussi vite.`}
                    >
                      Supprimer
                    </ActionButton>
                  </div>
                )}
              </div>

              {canManage && (
                <details className="px-5 pb-4">
                  <summary className="cursor-pointer text-[13px] text-mid-gray hover:text-ink">
                    Modifier le nom ou l&apos;identifiant
                  </summary>
                  <ActionForm
                    action={updateStaffIdentity.bind(null, person.id)}
                    className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
                    successMessage="Identité mise à jour."
                  >
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Nom complet</span>
                      <input
                        name="fullName"
                        required
                        defaultValue={person.full_name}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Identifiant de connexion</span>
                      <input
                        name="username"
                        required
                        pattern="[a-zA-Z0-9._-]{3,32}"
                        autoCapitalize="none"
                        spellCheck={false}
                        defaultValue={person.username ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>E-mail de contact (facultatif)</span>
                      <input
                        name="email"
                        type="email"
                        defaultValue={person.email ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <div className="col-span-full flex items-center gap-4">
                      <button type="submit" className={buttonGhost}>
                        Enregistrer
                      </button>
                      <span className="text-caption text-mid-gray">
                        Un nouvel identifiant prend effet à la prochaine connexion ; la
                        session en cours n&apos;est pas coupée.
                      </span>
                    </div>
                  </ActionForm>
                </details>
              )}
            </div>
          ))}
        </div>
      </Card>

      {canManage && (
        <Card
          title="Nouveau compte"
          subtitle="L'employé se connecte avec son identifiant, pas avec une adresse e-mail. Le compte est actif dès sa création."
        >
          {serviceKeyMissing ? (
            <div className="p-5">
              <Notice tone="warning">
                La création de compte exige la clé <code>SUPABASE_SERVICE_ROLE_KEY</code>,
                qui n&apos;est pas encore renseignée. Tout le reste de cet écran
                (rôles, désactivation, suppression, déconnexion, permissions) fonctionne
                sans elle.
              </Notice>
            </div>
          ) : (
            <ActionForm
              action={submitStaff}
              className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 p-5"
              successMessage="Compte créé."
              resetOnSuccess
            >
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Nom complet</span>
                <input name="fullName" required className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Identifiant de connexion</span>
                <input
                  name="username"
                  required
                  pattern="[a-zA-Z0-9._-]{3,32}"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="camille"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>E-mail de contact (facultatif)</span>
                <input name="email" type="email" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Rôle</span>
                <select name="role" defaultValue="vendeuse" className={selectClass}>
                  <option value="vendeuse">Vendeur·euse</option>
                  <option value="gemmologue">Gemmologue</option>
                  <option value="admin">Administrateur</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Mot de passe provisoire</span>
                <input
                  name="password"
                  type="text"
                  minLength={12}
                  required
                  className={inputClass}
                />
              </label>
              <div className="col-span-full">
                <button type="submit" className={buttonPrimary}>
                  Créer le compte
                </button>
              </div>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}

async function PermissionsTab({
  session,
  staff,
}: {
  session: Session;
  staff: StaffRow[];
}) {
  if (!session.can(PERMISSIONS.systemePermissions)) {
    return (
      <Card>
        <EmptyState
          title="Droit insuffisant"
          hint="La gestion des permissions requiert « Gérer les permissions »."
        />
      </Card>
    );
  }

  const [{ data: catalogue }, { data: rolePermissions }, { data: overrides }] =
    await Promise.all([
      session.supabase
        .from("permission_catalogue")
        .select("key, category, label, description, sort")
        .order("category")
        .order("sort"),
      session.supabase.from("role_permissions").select("role, permission_key"),
      session.supabase.from("staff_permissions").select("staff_id, permission_key, granted"),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <Notice>
        L&apos;administrateur dispose de tous les droits par construction : il
        n&apos;apparaît pas dans la matrice. Une exception nominative l&apos;emporte
        toujours sur le défaut du rôle.
      </Notice>

      <Card title="Par catégorie" subtitle="Droits par défaut de chaque rôle">
        <RolePermissionMatrix
          permissions={catalogue ?? []}
          rolePermissions={rolePermissions ?? []}
        />
      </Card>

      <Card title="Par personne" subtitle="Exceptions nominatives">
        <StaffPermissionPanel
          staff={staff}
          permissions={catalogue ?? []}
          rolePermissions={rolePermissions ?? []}
          overrides={overrides ?? []}
        />
      </Card>
    </div>
  );
}

async function TerminalsTab({
  session,
  submitTerminal,
}: {
  session: Session;
  submitTerminal: (formData: FormData) => Promise<ActionResult<unknown>>;
}) {
  const { data: terminals } = await session.supabase
    .from("pos_terminals")
    .select("id, code, name, location, is_active, receipt_format, scanner_mode")
    .order("code");

  const canManage = session.can(PERMISSIONS.systemeCaisses);

  return (
    <div className="flex flex-col gap-6">
      <Card title="Caisses" subtitle={`${terminals?.length ?? 0} point(s) de vente`}>
        <div className="flex flex-col">
          {(terminals ?? []).map((terminal) => (
            <div key={terminal.id} className="border-b border-canvas last:border-b-0">
              <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2 text-body font-medium">
                    {terminal.name}
                    <Badge>{terminal.code}</Badge>
                    {!terminal.is_active && <Badge tone="danger">Hors service</Badge>}
                  </span>
                  <span className="text-[13px] text-mid-gray">
                    {terminal.location ?? "sans emplacement"} · ticket{" "}
                    {terminal.receipt_format.replace("_", " ")} · scanner {terminal.scanner_mode}
                  </span>
                </div>
                {canManage && (
                  <ActionButton
                    action={updateTerminal.bind(null, terminal.id, {
                      isActive: !terminal.is_active,
                    })}
                    className={`${buttonGhost} h-8 min-h-8 text-[13px]`}
                  >
                    {terminal.is_active ? "Mettre hors service" : "Remettre en service"}
                  </ActionButton>
                )}
              </div>

              {canManage && (
                <details className="px-5 pb-4">
                  <summary className="cursor-pointer text-[13px] text-mid-gray hover:text-ink">
                    Modifier la caisse
                  </summary>
                  <ActionForm
                    action={updateTerminalForm.bind(null, terminal.id)}
                    className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
                    successMessage="Caisse mise à jour."
                  >
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Nom</span>
                      <input
                        name="name"
                        required
                        defaultValue={terminal.name}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Emplacement</span>
                      <input
                        name="location"
                        defaultValue={terminal.location ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Format de ticket</span>
                      <select
                        name="receiptFormat"
                        defaultValue={terminal.receipt_format}
                        className={selectClass}
                      >
                        <option value="thermique_80">Thermique 80 mm</option>
                        <option value="thermique_58">Thermique 58 mm</option>
                        <option value="a4">A4</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Scanner</span>
                      <select
                        name="scannerMode"
                        defaultValue={terminal.scanner_mode}
                        className={selectClass}
                      >
                        <option value="clavier">Code-barres, clavier (HID)</option>
                        <option value="rfid">Lecteur RFID / NFC</option>
                        <option value="camera">Caméra</option>
                      </select>
                    </label>
                    <div className="col-span-full">
                      <button type="submit" className={buttonGhost}>
                        Enregistrer
                      </button>
                    </div>
                  </ActionForm>
                </details>
              )}
            </div>
          ))}
        </div>
      </Card>

      {canManage && (
        <Card title="Nouvelle caisse">
          <ActionForm
            action={submitTerminal}
            className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 p-5"
            successMessage="Caisse ajoutée."
            resetOnSuccess
          >
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Code</span>
              <input name="code" required placeholder="CAISSE-2" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Nom</span>
              <input name="name" required placeholder="Comptoir atelier" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Emplacement</span>
              <input name="location" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Format de ticket</span>
              <select name="receiptFormat" defaultValue="thermique_80" className={selectClass}>
                <option value="thermique_80">Thermique 80 mm</option>
                <option value="thermique_58">Thermique 58 mm</option>
                <option value="a4">A4</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Scanner</span>
              <select name="scannerMode" defaultValue="clavier" className={selectClass}>
                <option value="clavier">Code-barres, clavier (HID)</option>
                <option value="rfid">Lecteur RFID / NFC</option>
                <option value="camera">Caméra</option>
              </select>
            </label>
            <div className="col-span-full">
              <button type="submit" className={buttonPrimary}>
                Ajouter la caisse
              </button>
            </div>
          </ActionForm>
        </Card>
      )}

      <Card title="Brancher scanners et imprimantes">
        <div className="flex flex-col gap-4 p-5 text-body text-mid-gray">
          <div className="flex flex-col gap-1">
            <span className="text-body font-medium text-ink">Scanner de code-barres</span>
            <p>
              Un lecteur du commerce se comporte comme un clavier : il tape la
              référence puis Entrée. Rien à installer côté ERP — il suffit que le champ
              de recherche du point de vente ait le focus. Configurez une seule chose sur
              le lecteur lui-même, avec les codes-barres de paramétrage du fabricant :
              suffixe = Entrée. Les références (MP-BAG-0412) s&apos;impriment en Code128.
              Fonctionne en USB comme en Bluetooth, iPad compris.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body font-medium text-ink">Lecteur RFID / NFC</span>
            <p>
              Les lecteurs de comptoir RFID existent bel et bien (EPC UHF pour les
              plateaux de bijoux, 13,56 MHz pour les étiquettes à l&apos;unité) et la
              quasi-totalité sait se présenter en clavier, exactement comme un lecteur
              de code-barres. Le point de vente n&apos;a donc rien de spécial à faire :
              il reçoit un code, il le résout. Renseignez l&apos;EPC de la puce dans le
              champ « Puce RFID » de la fiche pièce — la base accepte indifféremment la
              référence ou la puce, et la casse n&apos;a pas d&apos;importance.
            </p>
            <p>
              Une pièce peut porter les deux : puce pour l&apos;inventaire tournant,
              code-barres pour l&apos;étiquette prix. Le choix « Scanner » ci-dessus est
              purement documentaire : il dit à l&apos;équipe ce qui est branché sur cette
              caisse, il ne change aucun comportement.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body font-medium text-ink">
              Scanner ne vend pas : ça réserve
            </span>
            <p>
              Une pièce scannée est retenue 30 minutes, le temps de conclure. Elle reste
              en stock — le stock ne baisse qu&apos;au paiement — mais elle disparaît des
              pièces vendables, y compris pour le site web. Si le client renonce, retirez
              la ligne du panier : la pièce se rouvre aussitôt. Si personne ne fait rien,
              elle se rouvre seule à l&apos;expiration.
            </p>
            <p>
              C&apos;est la base qui arbitre, pas l&apos;écran : si la boutique et le site
              visent la même pièce à la même seconde, l&apos;un des deux est refusé avec un
              message clair. Le stock négatif est impossible.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body font-medium text-ink">Imprimantes</span>
            <p>
              Une page web ne peut pas parler ESC/POS en direct à une imprimante USB.
              L&apos;ERP produit donc du HTML au format du ticket et laisse le pilote
              système faire le reste : le ticket s&apos;imprime avec la boîte de dialogue
              du navigateur, sur Mac, Windows ou iPad. Choisissez le gabarit dans le
              champ « Format de ticket » ci-dessus.
            </p>
            <p>
              Si la boutique achète une thermique réseau (Star CloudPRNT, Epson Server
              Direct Print), l&apos;imprimante peut aussi interroger une file de travaux
              exposée par l&apos;ERP et récupérer ses tickets seule. À ajouter le jour où
              le matériel est là : l&apos;ERP reste sans pilote dans les deux cas.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

async function MaisonTab({ session }: { session: Session }) {
  if (session.role !== "admin") {
    return (
      <Card>
        <EmptyState
          title="Réservé aux administrateurs"
          hint="Le nom de la maison et les mentions légales des factures ne se modifient que par un administrateur."
        />
      </Card>
    );
  }

  const maison = await getMaison();

  return (
    <div className="flex flex-col gap-6">
      <Notice>
        Le nom d&apos;affichage apparaît partout dans l&apos;ERP. Les autres champs
        alimentent les mentions légales des factures, tickets de caisse et
        certificats — les documents déjà émis ne changent pas.
      </Notice>

      <Card title="Identité de la maison">
        <ActionForm
          action={updateMaisonSettings}
          className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 p-5"
          successMessage="Identité enregistrée."
        >
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Nom d&apos;affichage</span>
            <input
              name="displayName"
              required
              defaultValue={maison.displayName}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Raison sociale</span>
            <input
              name="legalName"
              required
              defaultValue={maison.legalName}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Rue et numéro</span>
            <input name="street" required defaultValue={maison.street} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Code postal</span>
            <input
              name="postalCode"
              required
              defaultValue={maison.postalCode}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Ville</span>
            <input name="city" required defaultValue={maison.city} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Pays</span>
            <input name="country" required defaultValue={maison.country} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Numéro de TVA</span>
            <input
              name="vatNumber"
              required
              defaultValue={maison.vatNumber}
              className={inputClass}
            />
          </label>
          <div className="col-span-full">
            <button type="submit" className={buttonPrimary}>
              Enregistrer
            </button>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}

async function ActivityTab({
  session,
  acteur,
  action,
  staff,
}: {
  session: Session;
  acteur?: string;
  action?: string;
  staff: StaffRow[];
}) {
  if (!session.can(PERMISSIONS.systemeJournal)) {
    return (
      <Card>
        <EmptyState
          title="Droit insuffisant"
          hint="La lecture du journal requiert « Consulter le journal »."
        />
      </Card>
    );
  }

  let query = session.supabase
    .from("activity_log")
    .select(
      "id, occurred_at, actor_name, actor_role, action, entity_type, entity_label, summary, ip_address, user_agent",
    )
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (acteur) query = query.eq("actor_id", acteur);
  if (action) query = query.eq("action", action as Database["public"]["Enums"]["activity_action"]);

  const { data: entries } = await query;

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-wrap items-end gap-3" action="/reglages">
        <input type="hidden" name="onglet" value="journal" />
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Auteur</span>
          <select name="acteur" defaultValue={acteur ?? ""} className={`${selectClass} w-56`}>
            <option value="">Tous</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Action</span>
          <select name="action" defaultValue={action ?? ""} className={`${selectClass} w-56`}>
            <option value="">Toutes</option>
            {Object.entries(ACTIVITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonGhost}>
          Filtrer
        </button>
      </form>

      <Card title="Journal d'activité" subtitle={`${entries?.length ?? 0} entrée(s) · 200 plus récentes`}>
        {(entries ?? []).length === 0 ? (
          <EmptyState
            title="Journal vide"
            hint="Les connexions et les actions métier s'inscrivent ici automatiquement."
          />
        ) : (
          <div className="flex flex-col">
            {entries!.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[150px_1fr_130px] items-start gap-4 border-b border-canvas px-5 py-3 last:border-b-0 max-lg:grid-cols-1"
              >
                <span className="tabular text-[13px] text-mid-gray">
                  {entry.occurred_at.slice(0, 16).replace("T", " ")}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-body">
                    <span className="font-medium">{entry.actor_name}</span>
                    {" · "}
                    {ACTIVITY_LABELS[entry.action] ?? entry.action}
                  </span>
                  <span className="text-[13px] text-mid-gray">
                    {entry.summary}
                    {entry.entity_label ? ` · ${entry.entity_label}` : ""}
                  </span>
                </div>
                <span className="tabular text-caption text-mid-gray">
                  {String(entry.ip_address ?? "—")}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

async function SessionsTab({ session }: { session: Session }) {
  if (session.role !== "admin") {
    return (
      <Card>
        <EmptyState
          title="Réservé aux administrateurs"
          hint="Les sessions actives et leurs adresses IP ne sont lisibles que par un administrateur."
        />
      </Card>
    );
  }

  const { data: sessions, error } = await session.supabase.rpc("admin_active_sessions");

  return (
    <Card
      title="Sessions actives"
      subtitle="Source : auth.sessions · mise à jour à chaque rafraîchissement de jeton"
    >
      {error ? (
        <EmptyState title="Sessions indisponibles" hint={error.message} />
      ) : (sessions ?? []).length === 0 ? (
        <EmptyState title="Aucune session ouverte" />
      ) : (
        <div className="flex flex-col">
          {sessions!.map((entry) => (
            <div
              key={entry.session_id}
              className="grid grid-cols-[1fr_150px_150px_auto] items-center gap-4 border-b border-canvas px-5 py-4 last:border-b-0 max-lg:grid-cols-1"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-body font-medium">{entry.full_name}</span>
                <span className="truncate text-caption text-mid-gray">
                  {entry.login} · {STAFF_ROLE_LABELS[entry.role]}
                </span>
              </div>
              <span className="tabular text-[13px]">{entry.ip ?? "IP inconnue"}</span>
              <span className="tabular text-caption text-mid-gray">
                {entry.last_seen_at?.slice(0, 16).replace("T", " ")}
              </span>
              <ActionButton
                action={revokeStaffSessions.bind(null, entry.user_id)}
                className={`${buttonGhost} h-8 min-h-8 text-[13px]`}
              >
                Déconnecter
              </ActionButton>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
