"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { createServiceClient } from "@/lib/supabase/server";
import { PERMISSIONS, STAFF_ROLE_LABELS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type StaffRole = Database["public"]["Enums"]["staff_role"];

const MISSING_SERVICE_KEY =
  "Création impossible : la clé service_role n'est pas configurée. " +
  "Renseignez SUPABASE_SERVICE_ROLE_KEY dans .env.local et sur Vercel, " +
  "ou créez le compte depuis le tableau de bord Supabase puis rattachez-le ici.";

/**
 * Domaine réservé par la RFC 2606 : garantit qu'aucun courrier ne partira
 * jamais vers ces adresses techniques, que personne ne voit ni ne saisit.
 */
const INTERNAL_DOMAIN = "maison-piron.invalid";

const createStaffSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9._-]{3,32}$/,
      "3 à 32 caractères : lettres sans accent, chiffres, point, tiret",
    ),
  email: z.union([z.email("Adresse e-mail invalide"), z.literal("")]).nullish(),
  fullName: z.string().trim().min(2, "Nom trop court"),
  role: z.enum(["admin", "gemmologue", "vendeuse"]),
  password: z.string().min(12, "12 caractères minimum"),
});

/**
 * Seule action qui exige la clé service_role : l'API d'administration gère le
 * hachage du mot de passe et la ligne d'identité. Tout le reste (rôle,
 * désactivation, suppression, révocation) passe par des fonctions SQL.
 */
export async function createStaffAccount(
  input: z.input<typeof createStaffSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Formulaire incomplet",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.systemeEmployes);
    const d = parsed.data;

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { ok: false, error: MISSING_SERVICE_KEY };
    }

    const admin = createServiceClient();

    // Un identifiant déjà pris doit être refusé avant la création du compte
    // Auth : sinon il resterait un utilisateur sans fiche employé.
    const { data: taken } = await admin
      .from("staff_profiles")
      .select("id")
      .eq("username", d.username)
      .maybeSingle();

    if (taken) {
      return {
        ok: false,
        error: "Identifiant déjà utilisé",
        fieldErrors: { username: ["Identifiant déjà utilisé"] },
      };
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${d.username}@${INTERNAL_DOMAIN}`,
      password: d.password,
      email_confirm: true,
      user_metadata: { full_name: d.fullName },
    });

    if (error || !created.user) {
      return { ok: false, error: error?.message ?? "Compte non créé" };
    }

    const { error: profileError } = await admin.from("staff_profiles").insert({
      id: created.user.id,
      full_name: d.fullName,
      role: d.role,
      username: d.username,
      email: d.email || null,
    });

    if (profileError) {
      // Sans fiche employé, le compte ne verrait rien : on annule plutôt que
      // de laisser un compte fantôme capable de se connecter.
      await admin.auth.admin.deleteUser(created.user.id);
      return { ok: false, error: profileError.message };
    }

    await logActivity(session, {
      action: "employe_cree",
      summary: `Compte ${d.username} créé · ${STAFF_ROLE_LABELS[d.role]}`,
      entityType: "staff",
      entityId: created.user.id,
      entityLabel: d.fullName,
    });

    revalidatePath("/reglages");
    return { ok: true, data: { id: created.user.id } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

const updateStaffIdentitySchema = createStaffSchema.pick({
  username: true,
  email: true,
  fullName: true,
});

/**
 * Nom, identifiant et e-mail de contact. Tout passe par la fonction SQL
 * `admin_update_staff_identity` : staff_profiles n'a aucune policy d'écriture,
 * et l'adresse technique de connexion (identifiant@maison-piron.invalid) doit
 * suivre l'identifiant dans auth.users, ce que seule la base peut garantir
 * atomiquement.
 */
export async function updateStaffIdentity(
  staffId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateStaffIdentitySchema.safeParse({
    username: String(formData.get("username") ?? ""),
    email: String(formData.get("email") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: "Formulaire incomplet",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.systemeEmployes);
    const d = parsed.data;

    const { data: before } = await session.supabase
      .from("staff_profiles")
      .select("full_name, username, email")
      .eq("id", staffId)
      .single();

    const { error } = await session.supabase.rpc("admin_update_staff_identity", {
      target_user_id: staffId,
      full_name_param: d.fullName,
      username_param: d.username,
      email_param: d.email || "",
    });

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "employe_modifie",
      summary:
        before?.username && before.username !== d.username
          ? `Identité de ${before?.full_name ?? "l'employé"} mise à jour · identifiant ${before.username} → ${d.username}`
          : `Identité de ${before?.full_name ?? "l'employé"} mise à jour`,
      entityType: "staff",
      entityId: staffId,
      entityLabel: d.fullName,
      changes: {
        avant: {
          nom: before?.full_name ?? null,
          identifiant: before?.username ?? null,
          email: before?.email ?? null,
        },
        apres: { nom: d.fullName, identifiant: d.username, email: d.email || null },
      },
    });

    revalidatePath("/reglages");
    return { ok: true, data: { id: staffId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function setStaffRole(
  staffId: string,
  role: StaffRole,
): Promise<ActionResult<{ role: StaffRole }>> {
  try {
    const session = await requirePermission(PERMISSIONS.systemeEmployes);

    const { data: before } = await session.supabase
      .from("staff_profiles")
      .select("full_name, role")
      .eq("id", staffId)
      .single();

    const { error } = await session.supabase.rpc("admin_set_staff_role", {
      target_user_id: staffId,
      role_param: role,
    });

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "employe_modifie",
      summary: `${before?.full_name ?? "Employé"} : ${STAFF_ROLE_LABELS[before?.role ?? "vendeuse"]} → ${STAFF_ROLE_LABELS[role]}`,
      entityType: "staff",
      entityId: staffId,
      entityLabel: before?.full_name,
      changes: { avant: { role: before?.role ?? null }, apres: { role } },
    });

    revalidatePath("/reglages");
    return { ok: true, data: { role } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/** Désactiver conserve tout l'historique et coupe l'accès immédiatement. */
export async function setStaffActive(
  staffId: string,
  active: boolean,
): Promise<ActionResult<{ active: boolean }>> {
  try {
    const session = await requirePermission(PERMISSIONS.systemeEmployes);

    const { data: before } = await session.supabase
      .from("staff_profiles")
      .select("full_name")
      .eq("id", staffId)
      .single();

    const { error } = await session.supabase.rpc("admin_set_staff_active", {
      target_user_id: staffId,
      active_param: active,
    });

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: active ? "employe_modifie" : "employe_desactive",
      summary: `${before?.full_name ?? "Employé"} ${active ? "réactivé" : "désactivé, sessions révoquées"}`,
      entityType: "staff",
      entityId: staffId,
      entityLabel: before?.full_name,
    });

    revalidatePath("/reglages");
    return { ok: true, data: { active } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function revokeStaffSessions(
  staffId: string,
): Promise<ActionResult<{ revoked: number }>> {
  try {
    const session = await requirePermission(PERMISSIONS.systemeEmployes);

    const { data: before } = await session.supabase
      .from("staff_profiles")
      .select("full_name")
      .eq("id", staffId)
      .single();

    const { data, error } = await session.supabase.rpc("admin_revoke_sessions", {
      target_user_id: staffId,
    });

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "session_revoquee",
      summary: `${data ?? 0} session(s) fermée(s) pour ${before?.full_name ?? "un employé"}`,
      entityType: "staff",
      entityId: staffId,
      entityLabel: before?.full_name,
    });

    revalidatePath("/reglages");
    return { ok: true, data: { revoked: data ?? 0 } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Suppression définitive du compte. L'historique comptable survit : les clés
 * étrangères des tables financières passent à null, et le journal d'activité
 * garde le nom figé au moment de l'action.
 */
export async function deleteStaffAccount(
  staffId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.systemeEmployes);

    const { data: before } = await session.supabase
      .from("staff_profiles")
      .select("full_name, username, email")
      .eq("id", staffId)
      .single();

    // Journalisé avant la suppression : après, le nom n'est plus lisible.
    await logActivity(session, {
      action: "employe_supprime",
      summary: `Compte ${before?.username ?? before?.email ?? staffId} supprimé définitivement`,
      entityType: "staff",
      entityId: staffId,
      entityLabel: before?.full_name,
    });

    const { error } = await session.supabase.rpc("admin_delete_staff", {
      target_user_id: staffId,
    });

    if (error) return { ok: false, error: actionError(error) };

    revalidatePath("/reglages");
    return { ok: true, data: { id: staffId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/** Droit par défaut d'un rôle : le réglage « par catégorie ». */
export async function setRolePermission(
  role: StaffRole,
  permissionKey: string,
  granted: boolean,
): Promise<ActionResult<{ granted: boolean }>> {
  try {
    const session = await requirePermission(PERMISSIONS.systemePermissions);

    if (role === "admin") {
      return {
        ok: false,
        error: "Le rôle administrateur dispose de tous les droits par construction",
      };
    }

    const { error } = granted
      ? await session.supabase
          .from("role_permissions")
          .upsert({ role, permission_key: permissionKey }, { onConflict: "role,permission_key" })
      : await session.supabase
          .from("role_permissions")
          .delete()
          .eq("role", role)
          .eq("permission_key", permissionKey);

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "permission_modifiee",
      summary: `${STAFF_ROLE_LABELS[role]} : ${permissionKey} ${granted ? "accordé" : "retiré"}`,
      entityType: "role_permission",
      entityLabel: `${role} · ${permissionKey}`,
      changes: { apres: { role, permission: permissionKey, accorde: granted } },
    });

    revalidatePath("/reglages");
    return { ok: true, data: { granted } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Exception nominative. `granted = null` retire l'exception et rend la personne
 * au droit par défaut de son rôle.
 */
export async function setStaffPermission(
  staffId: string,
  permissionKey: string,
  granted: boolean | null,
): Promise<ActionResult<{ granted: boolean | null }>> {
  try {
    const session = await requirePermission(PERMISSIONS.systemePermissions);

    const { data: staff } = await session.supabase
      .from("staff_profiles")
      .select("full_name")
      .eq("id", staffId)
      .single();

    const { error } =
      granted === null
        ? await session.supabase
            .from("staff_permissions")
            .delete()
            .eq("staff_id", staffId)
            .eq("permission_key", permissionKey)
        : await session.supabase.from("staff_permissions").upsert(
            {
              staff_id: staffId,
              permission_key: permissionKey,
              granted,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "staff_id,permission_key" },
          );

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "permission_modifiee",
      summary: `${staff?.full_name ?? "Employé"} : ${permissionKey} ${
        granted === null ? "revenu au défaut du rôle" : granted ? "accordé" : "retiré"
      }`,
      entityType: "staff_permission",
      entityId: staffId,
      entityLabel: staff?.full_name,
      changes: { apres: { permission: permissionKey, accorde: granted } },
    });

    revalidatePath("/reglages");
    return { ok: true, data: { granted } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
