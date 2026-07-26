"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRolePermission, setStaffPermission } from "@/actions/staff";
import { PERMISSION_PAGES, STAFF_ROLE_LABELS } from "@/lib/permissions";
import { selectClass } from "@/components/ui";
import type { Database } from "@/types/database.types";

type StaffRole = Database["public"]["Enums"]["staff_role"];
type Permission = { key: string; category: string; label: string; description: string };
type PermissionPage = (typeof PERMISSION_PAGES)[number];

const EDITABLE_ROLES: StaffRole[] = ["gemmologue", "vendeuse"];

const DIMMED_TITLE = "Sans accès à la page, ce droit est sans effet";

/** Lignes du bloc « page », la ligne d'accès (`viewKey`) en premier. */
function pageRows(page: PermissionPage, permissions: Permission[]): Permission[] {
  const rows = page.only
    ? permissions.filter((p) => page.only!.includes(p.key))
    : permissions.filter(
        (p) =>
          page.prefix !== undefined &&
          p.key.startsWith(page.prefix) &&
          !(page.exclude ?? []).includes(p.key),
      );
  return [
    ...rows.filter((r) => r.key === page.viewKey),
    ...rows.filter((r) => r.key !== page.viewKey),
  ];
}

/** Matrice « par page » : les droits par défaut de chaque rôle. */
export function RolePermissionMatrix({
  permissions,
  rolePermissions,
}: {
  permissions: Permission[];
  rolePermissions: { role: StaffRole; permission_key: string }[];
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic par case : la valeur cliquée s'affiche immédiatement, la case
  // n'est désactivée que pendant sa propre requête (pas de pending global).
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const router = useRouter();

  const granted = new Set(rolePermissions.map((r) => `${r.role}:${r.permission_key}`));

  // L'overlay optimiste n'est purgé que sur erreur (rollback) : après succès il
  // vaut exactement la valeur serveur, le garder ne change rien à l'affichage.
  const isChecked = (role: StaffRole, key: string) => {
    const k = `${role}:${key}`;
    return optimistic[k] ?? granted.has(k);
  };

  function toggle(role: StaffRole, key: string, next: boolean) {
    const k = `${role}:${key}`;
    setError(null);
    setOptimistic((prev) => ({ ...prev, [k]: next }));
    setInFlight((prev) => new Set(prev).add(k));
    startTransition(async () => {
      const result = await setRolePermission(role, key, next);
      if (!result.ok) {
        setError(result.error);
        // Rollback : on retire la valeur optimiste, la case revient au serveur.
        setOptimistic((prev) => {
          const copy = { ...prev };
          delete copy[k];
          return copy;
        });
      } else {
        router.refresh();
      }
      setInFlight((prev) => {
        const copy = new Set(prev);
        copy.delete(k);
        return copy;
      });
    });
  }

  return (
    <div className="flex flex-col">
      {error && <p className="px-5 pt-4 text-caption text-ember">{error}</p>}
      {PERMISSION_PAGES.map((page) => {
        const rows = pageRows(page, permissions);
        if (rows.length === 0) return null;
        return (
          <div key={page.title} className="border-b border-canvas last:border-b-0">
            <div className="grid grid-cols-[1fr_120px_120px] items-center gap-4 bg-surface-alt px-5 py-2">
              <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">
                {page.title}
              </span>
              {EDITABLE_ROLES.map((role) => (
                <span
                  key={role}
                  className="text-center text-caption uppercase tracking-[0.6px] text-mid-gray"
                >
                  {STAFF_ROLE_LABELS[role]}
                </span>
              ))}
            </div>
            {page.note && (
              <p className="px-5 pt-2 text-caption text-mid-gray">{page.note}</p>
            )}
            {rows.map((permission) => {
              const isViewRow = permission.key === page.viewKey;
              return (
                <div
                  key={permission.key}
                  className="grid grid-cols-[1fr_120px_120px] items-center gap-4 px-5 py-3"
                >
                  <div className={`flex min-w-0 flex-col ${isViewRow ? "" : "pl-8"}`}>
                    <span className="text-body">
                      {isViewRow && page.viewKey !== null && !page.only
                        ? "Accès à la page"
                        : permission.label}
                    </span>
                    <span className="text-caption text-mid-gray">
                      {permission.description}
                    </span>
                  </div>
                  {EDITABLE_ROLES.map((role) => {
                    const k = `${role}:${permission.key}`;
                    // Une action dont la page est inaccessible au rôle reste
                    // cliquable mais s'affiche estompée : la garde de page
                    // bloque de toute façon, pas besoin de cascade en base.
                    const dimmed =
                      !isViewRow &&
                      page.viewKey !== null &&
                      !isChecked(role, page.viewKey);
                    return (
                      <label
                        key={role}
                        className={`flex justify-center ${dimmed ? "opacity-40" : ""}`}
                        title={dimmed ? DIMMED_TITLE : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked(role, permission.key)}
                          disabled={inFlight.has(k)}
                          className="size-4 accent-ink"
                          onChange={(event) =>
                            toggle(role, permission.key, event.target.checked)
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Exceptions « par personne » : accordé, retiré, ou retour au défaut du rôle. */
export function StaffPermissionPanel({
  staff,
  permissions,
  rolePermissions,
  overrides,
}: {
  staff: { id: string; full_name: string; role: StaffRole }[];
  permissions: Permission[];
  rolePermissions: { role: StaffRole; permission_key: string }[];
  overrides: { staff_id: string; permission_key: string; granted: boolean }[];
}) {
  const nonAdmin = staff.filter((s) => s.role !== "admin");
  const [selected, setSelected] = useState(nonAdmin[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const person = staff.find((s) => s.id === selected);

  if (!person) {
    return (
      <p className="p-5 text-body text-mid-gray">
        Aucun employé non administrateur : les exceptions nominatives ne
        s&apos;appliquent qu&apos;aux rôles gemmologue et vendeur·euse.
      </p>
    );
  }

  const roleDefaults = new Set(
    rolePermissions.filter((r) => r.role === person.role).map((r) => r.permission_key),
  );
  const overrideMap = new Map(
    overrides.filter((o) => o.staff_id === person.id).map((o) => [o.permission_key, o.granted]),
  );

  /** Droit effectif de la personne : exception nominative, sinon défaut du rôle. */
  const effective = (key: string) => overrideMap.get(key) ?? roleDefaults.has(key);

  return (
    <div className="flex flex-col gap-4 p-5">
      <label className="flex max-w-xs flex-col gap-1">
        <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">Employé</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={selectClass}
        >
          {nonAdmin.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} · {STAFF_ROLE_LABELS[s.role]}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-caption text-ember">{error}</p>}

      <div className="flex flex-col gap-1">
        {PERMISSION_PAGES.map((page) => {
          const rows = pageRows(page, permissions);
          if (rows.length === 0) return null;
          const pageAccessible = page.viewKey === null || effective(page.viewKey);
          return (
            <div key={page.title} className="flex flex-col">
              <span className="pb-1 pt-3 text-caption uppercase tracking-[0.6px] text-mid-gray">
                {page.title}
              </span>
              {rows.map((permission) => {
                const isViewRow = permission.key === page.viewKey;
                const override = overrideMap.get(permission.key);
                const value =
                  override === undefined ? "defaut" : override ? "accorde" : "retire";
                const byDefault = roleDefaults.has(permission.key);
                const dimmed = !isViewRow && !pageAccessible;
                return (
                  <div
                    key={permission.key}
                    className={`grid grid-cols-[1fr_180px] items-center gap-4 border-b border-canvas py-2 last:border-b-0 ${
                      dimmed ? "opacity-40" : ""
                    }`}
                    title={dimmed ? DIMMED_TITLE : undefined}
                  >
                    <div className={`flex min-w-0 flex-col ${isViewRow ? "" : "pl-8"}`}>
                      <span className="text-body">
                        {isViewRow && page.viewKey !== null && !page.only
                          ? "Accès à la page"
                          : permission.label}
                      </span>
                      <span className="text-caption text-mid-gray">
                        Défaut du rôle : {byDefault ? "accordé" : "refusé"}
                      </span>
                    </div>
                    <select
                      value={value}
                      disabled={pending}
                      className={selectClass}
                      onChange={(event) => {
                        const next = event.target.value;
                        setError(null);
                        startTransition(async () => {
                          const result = await setStaffPermission(
                            person.id,
                            permission.key,
                            next === "defaut" ? null : next === "accorde",
                          );
                          if (!result.ok) setError(result.error);
                          router.refresh();
                        });
                      }}
                    >
                      <option value="defaut">Défaut du rôle</option>
                      <option value="accorde">Accordé</option>
                      <option value="retire">Retiré</option>
                    </select>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
