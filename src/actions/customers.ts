"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { diffOf, logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";

const customerSchema = z.object({
  fullName: z.string().trim().min(2, "Nom trop court"),
  email: z.email("Adresse e-mail invalide").nullish().or(z.literal("")),
  phone: z.string().trim().nullish(),
  street: z.string().trim().nullish(),
  postalCode: z.string().trim().nullish(),
  city: z.string().trim().nullish(),
  isPrivilege: z.boolean().default(false),
});

const preferencesSchema = z.object({
  ringSizeEu: z.number().positive().nullish(),
  preferredMetal: z.enum(["or", "argent", "platine"]).nullish(),
  preferredStone: z.string().trim().nullish(),
  contactLanguage: z.enum(["fr", "nl", "en", "de"]).default("fr"),
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createCustomer(
  input: z.input<typeof customerSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Fiche incomplète",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.clienteleCreer);
    const d = parsed.data;

    const { data: customer, error } = await session.supabase
      .from("customers")
      .insert({
        full_name: d.fullName,
        email: blankToNull(d.email),
        phone: blankToNull(d.phone),
        street: blankToNull(d.street),
        postal_code: blankToNull(d.postalCode),
        city: blankToNull(d.city),
        is_privilege: d.isPrivilege,
      })
      .select("id, full_name")
      .single();

    if (error) return { ok: false, error: error.message };

    await logActivity(session, {
      action: "client_cree",
      summary: `Fiche client créée : ${customer.full_name}`,
      entityType: "customer",
      entityId: customer.id,
      entityLabel: customer.full_name ?? undefined,
    });

    revalidatePath("/clientele");
    return { ok: true, data: { id: customer.id } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function updateCustomer(
  customerId: string,
  input: z.input<typeof customerSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Fiche incomplète",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.clienteleModifier);
    const d = parsed.data;

    const { data: before, error: readError } = await session.supabase
      .from("customers")
      .select("full_name, email, phone, street, postal_code, city, is_privilege, is_anonymized")
      .eq("id", customerId)
      .single();

    if (readError) return { ok: false, error: readError.message };
    if (before.is_anonymized) {
      return { ok: false, error: "Fiche anonymisée : elle ne peut plus être modifiée" };
    }

    const patch = {
      full_name: d.fullName,
      email: blankToNull(d.email),
      phone: blankToNull(d.phone),
      street: blankToNull(d.street),
      postal_code: blankToNull(d.postalCode),
      city: blankToNull(d.city),
      is_privilege: d.isPrivilege,
    };

    const { error } = await session.supabase
      .from("customers")
      .update(patch)
      .eq("id", customerId);

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "client_modifie",
      summary: `Fiche de ${d.fullName} modifiée`,
      entityType: "customer",
      entityId: customerId,
      entityLabel: d.fullName,
      changes: diffOf(before as Record<string, unknown>, patch),
    });

    revalidatePath("/clientele");
    revalidatePath(`/clientele/${customerId}`);
    return { ok: true, data: { id: customerId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function updateCustomerPreferences(
  customerId: string,
  input: z.input<typeof preferencesSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Préférences invalides" };

  try {
    const session = await requirePermission(PERMISSIONS.clienteleModifier);
    const d = parsed.data;

    const { error } = await session.supabase.from("customer_preferences").upsert(
      {
        customer_id: customerId,
        ring_size_eu: d.ringSizeEu ?? null,
        preferred_metal: d.preferredMetal ?? null,
        preferred_stone: blankToNull(d.preferredStone),
        contact_language: d.contactLanguage,
      },
      { onConflict: "customer_id" },
    );

    if (error) return { ok: false, error: actionError(error) };

    revalidatePath(`/clientele/${customerId}`);
    return { ok: true, data: { id: customerId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function recordCustomerConsent(
  customerId: string,
  granted: boolean,
  expiresAt: string | null,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.clienteleModifier);

    const { error } = await session.supabase.from("customer_consents").insert({
      customer_id: customerId,
      granted,
      expires_at: expiresAt,
      source: "back-office",
    });

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "client_modifie",
      summary: granted
        ? `Consentement marketing accordé${expiresAt ? ` jusqu'au ${expiresAt}` : ""}`
        : "Consentement marketing retiré",
      entityType: "customer",
      entityId: customerId,
    });

    revalidatePath(`/clientele/${customerId}`);
    return { ok: true, data: { id: customerId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * La suppression pure n'est possible que pour une fiche sans historique.
 * Dès qu'une vente ou une réparation existe, la voie légale est l'anonymisation.
 */
export async function deleteCustomer(
  customerId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.clienteleSupprimer);

    const { data: before } = await session.supabase
      .from("customers")
      .select("full_name")
      .eq("id", customerId)
      .single();

    const [sales, tickets] = await Promise.all([
      session.supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId),
      session.supabase
        .from("repair_tickets")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId),
    ]);

    if ((sales.count ?? 0) > 0 || (tickets.count ?? 0) > 0) {
      return {
        ok: false,
        error:
          "Ce client a un historique commercial : utilisez l'anonymisation RGPD, qui efface les coordonnées tout en conservant les pièces comptables.",
      };
    }

    const { error } = await session.supabase
      .from("customers")
      .delete()
      .eq("id", customerId);

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "client_supprime",
      summary: `Fiche de ${before?.full_name ?? "client"} supprimée (aucun historique)`,
      entityType: "customer",
      entityId: customerId,
      entityLabel: before?.full_name ?? undefined,
    });

    revalidatePath("/clientele");
    return { ok: true, data: { id: customerId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
