"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRolePermission, setStaffPermission } from "@/actions/staff";
import { PERMISSION_CATEGORIES, STAFF_ROLE_LABELS } from "@/lib/permissions";
import { selectClass } from "@/components/ui";
import type { Database } from "@/types/database.types";

type StaffRole = Database["public"]["Enums"]["staff_role"];
type Permission = { key: string; category: string; label: string; description: string };

const EDITABLE_ROLES: StaffRole[] = ["gemmologue", "vendeuse"];

/** Matrice « par catégorie » : les droits par défaut de chaque rôle. */
export function RolePermissionMatrix({
  permissions,
  rolePermissions,
}: {
  permissions: Permission[];
  rolePermissions: { role: StaffRole; permission_key: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const granted = new Set(rolePermissions.map((r) => `${r.role}:${r.permission_key}`));

  return (
    <div className="flex flex-col">
      {error && <p className="px-5 pt-4 text-caption text-ember">{error}</p>}
      {PERMISSION_CATEGORIES.map((category) => {
        const rows = permissions.filter((p) => p.category === category);
        if (rows.length === 0) return null;
        return (
          <div key={category} className="border-b border-canvas last:border-b-0">
            <div className="grid grid-cols-[1fr_120px_120px] items-center gap-4 bg-surface-alt px-5 py-2">
              <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">
                {category}
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
            {rows.map((permission) => (
              <div
                key={permission.key}
                className="grid grid-cols-[1fr_120px_120px] items-center gap-4 px-5 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-body">{permission.label}</span>
                  <span className="text-caption text-mid-gray">{permission.description}</span>
                </div>
                {EDITABLE_ROLES.map((role) => {
                  const checked = granted.has(`${role}:${permission.key}`);
                  return (
                    <label key={role} className="flex justify-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending}
                        className="size-4 accent-ink"
                        onChange={(event) => {
                          const next = event.target.checked;
                          setError(null);
                          startTransition(async () => {
                            const result = await setRolePermission(role, permission.key, next);
                            if (!result.ok) setError(result.error);
                            router.refresh();
                          });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            ))}
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
        {PERMISSION_CATEGORIES.map((category) => {
          const rows = permissions.filter((p) => p.category === category);
          if (rows.length === 0) return null;
          return (
            <div key={category} className="flex flex-col">
              <span className="pb-1 pt-3 text-caption uppercase tracking-[0.6px] text-mid-gray">
                {category}
              </span>
              {rows.map((permission) => {
                const override = overrideMap.get(permission.key);
                const value =
                  override === undefined ? "defaut" : override ? "accorde" : "retire";
                const byDefault = roleDefaults.has(permission.key);
                return (
                  <div
                    key={permission.key}
                    className="grid grid-cols-[1fr_180px] items-center gap-4 border-b border-canvas py-2 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-body">{permission.label}</span>
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
