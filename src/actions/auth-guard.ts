import { createClient } from "@/lib/supabase/server";
import type { PermissionKey } from "@/lib/permissions";
import type { Database } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

type StaffRole = Database["public"]["Enums"]["staff_role"];

export type StaffSession = {
  supabase: SupabaseClient<Database>;
  userId: string;
  fullName: string;
  role: StaffRole;
  permissions: Set<string>;
  can: (permission: PermissionKey) => boolean;
};

/**
 * Les Server Actions sont joignables par POST direct : chacune doit vérifier
 * l'identité et les droits. La RLS et les triggers de colonnes refusent aussi
 * l'écriture — cette garde sert à rendre l'erreur lisible, pas à protéger seule.
 */
export async function requireStaff(): Promise<StaffSession> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Authentification requise");

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) throw new Error("Compte sans fiche employé");
  if (!profile.is_active) throw new Error("Compte désactivé");

  const { data: keys } = await supabase.rpc("my_permissions");
  const permissions = new Set<string>(keys ?? []);

  return {
    supabase,
    userId: user.id,
    fullName: profile.full_name,
    role: profile.role,
    permissions,
    can: (permission) => permissions.has(permission),
  };
}

export async function requirePermission(
  permission: PermissionKey,
): Promise<StaffSession> {
  const session = await requireStaff();
  if (!session.can(permission)) {
    throw new Error("Vous n'avez pas le droit d'effectuer cette action");
  }
  return session;
}

/** Variante non bloquante pour les pages : rend la session ou null. */
export async function getStaffSession(): Promise<StaffSession | null> {
  try {
    return await requireStaff();
  } catch {
    return null;
  }
}
