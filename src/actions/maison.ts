"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStaffSession } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { actionError, type ActionResult } from "@/actions/types";

const maisonSchema = z.object({
  displayName: z.string().trim().min(2, "Nom trop court"),
  legalName: z.string().trim().min(2, "Raison sociale trop courte"),
  street: z.string().trim().min(2, "Adresse requise"),
  postalCode: z.string().trim().min(2, "Code postal requis"),
  city: z.string().trim().min(1, "Ville requise"),
  country: z.string().trim().min(2, "Pays requis"),
  vatNumber: z.string().trim().min(4, "Numéro de TVA requis"),
});

/**
 * Identité de la boutique. La fonction SQL `admin_update_maison_settings`
 * re-vérifie le rôle : ces mentions alimentent factures, tickets et
 * certificats, elles ne se modifient pas par un PATCH direct.
 */
export async function updateMaisonSettings(
  formData: FormData,
): Promise<ActionResult<{ displayName: string }>> {
  const parsed = maisonSchema.safeParse({
    displayName: String(formData.get("displayName") ?? ""),
    legalName: String(formData.get("legalName") ?? ""),
    street: String(formData.get("street") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
    city: String(formData.get("city") ?? ""),
    country: String(formData.get("country") ?? ""),
    vatNumber: String(formData.get("vatNumber") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: "Formulaire incomplet",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await getStaffSession();
    if (!session) return { ok: false, error: "Session expirée" };
    if (session.role !== "admin") {
      return { ok: false, error: "Action réservée aux administrateurs" };
    }

    const d = parsed.data;

    const { data: before } = await session.supabase
      .from("maison_settings")
      .select("display_name, legal_name, vat_number")
      .maybeSingle();

    const { error } = await session.supabase.rpc("admin_update_maison_settings", {
      display_name_param: d.displayName,
      legal_name_param: d.legalName,
      street_param: d.street,
      postal_code_param: d.postalCode,
      city_param: d.city,
      country_param: d.country,
      vat_number_param: d.vatNumber,
    });

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "maison_modifiee",
      summary: `Identité de la maison mise à jour · ${d.displayName}`,
      entityType: "maison_settings",
      entityLabel: d.displayName,
      changes: {
        avant: {
          nom: before?.display_name ?? null,
          raison_sociale: before?.legal_name ?? null,
          tva: before?.vat_number ?? null,
        },
        apres: { nom: d.displayName, raison_sociale: d.legalName, tva: d.vatNumber },
      },
    });

    // Le nom apparaît dans chaque fil d'Ariane et le titre de l'onglet.
    revalidatePath("/", "layout");
    return { ok: true, data: { displayName: d.displayName } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
