"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { diffOf, logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { PRODUCT_STATUS_LABELS } from "@/lib/constants";
import { actionError, type ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type ProductStatus = Database["public"]["Enums"]["product_status"];

const materialSchema = z.object({
  metalKind: z.enum(["or", "argent", "platine"]),
  purityPerMille: z.number().int().min(1).max(1000),
  color: z.enum(["jaune", "blanc", "rose"]).nullish(),
  weightGrams: z.number().positive("Le poids doit être supérieur à zéro"),
  detail: z.string().trim().nullish(),
});

const gemstoneSchema = z.object({
  name: z.string().trim().min(1, "Nommez la pierre"),
  gemstoneType: z.enum(["diamant", "emeraude", "saphir", "rubis", "perle", "autre"]),
  caratWeight: z.number().positive(),
  stoneCount: z.number().int().positive().default(1),
  pricePerCarat: z.number().nonnegative().default(0),
  clarity: z.string().trim().nullish(),
  color: z.string().trim().nullish(),
  cut: z.string().trim().nullish(),
  certificateLab: z.enum(["GIA", "IGI", "HRD", "autre", "aucun"]).default("aucun"),
  certificateNumber: z.string().trim().nullish(),
});

const createProductSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(3, "Référence trop courte")
    .regex(/^[A-Za-z0-9-]+$/, "Lettres, chiffres et tirets uniquement"),
  name: z.string().trim().min(2, "Nommez la pièce"),
  description: z.string().trim().nullish(),
  showcaseSlot: z.string().trim().nullish(),
  laborCostEur: z.number().nonnegative().default(0),
  laborDescription: z.string().trim().nullish(),
  marginMultiplier: z.number().positive().default(2),
  materials: z.array(materialSchema).default([]),
  gemstones: z.array(gemstoneSchema).default([]),
});

export async function createProduct(
  input: z.input<typeof createProductSchema>,
): Promise<ActionResult<{ id: string; sku: string }>> {
  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Fiche incomplète",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.inventaireCreer);
    const d = parsed.data;

    const { data: product, error } = await session.supabase
      .from("products")
      .insert({
        sku: d.sku.toUpperCase(),
        name: d.name,
        description: d.description ?? null,
        showcase_slot: d.showcaseSlot ?? null,
        labor_cost_eur: d.laborCostEur,
        labor_description: d.laborDescription ?? null,
        margin_multiplier: d.marginMultiplier,
      })
      .select("id, sku, name")
      .single();

    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Cette référence existe déjà" : error.message,
      };
    }

    if (d.materials.length > 0) {
      const { error: matError } = await session.supabase.from("product_materials").insert(
        d.materials.map((m) => ({
          product_id: product.id,
          metal_kind: m.metalKind,
          purity_per_mille: m.purityPerMille,
          color: m.color ?? null,
          weight_grams: m.weightGrams,
          detail: m.detail ?? null,
        })),
      );
      if (matError) return { ok: false, error: matError.message };
    }

    if (d.gemstones.length > 0) {
      const { error: gemError } = await session.supabase.from("product_gemstones").insert(
        d.gemstones.map((g) => ({
          product_id: product.id,
          name: g.name,
          gemstone_type: g.gemstoneType,
          carat_weight: g.caratWeight,
          stone_count: g.stoneCount,
          price_per_carat: g.pricePerCarat,
          clarity: g.clarity ?? null,
          color: g.color ?? null,
          cut: g.cut ?? null,
          certificate_lab: g.certificateLab,
          certificate_number: g.certificateNumber ?? null,
        })),
      );
      if (gemError) return { ok: false, error: gemError.message };
    }

    await logActivity(session, {
      action: "produit_cree",
      summary: `Pièce ${product.sku} créée · ${d.materials.length} matériau(x), ${d.gemstones.length} pierre(s)`,
      entityType: "product",
      entityId: product.id,
      entityLabel: `${product.name} · ${product.sku}`,
    });

    revalidatePath("/inventaire");
    return { ok: true, data: { id: product.id, sku: product.sku } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

const updateProductSchema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().nullish(),
  showcaseSlot: z.string().trim().nullish(),
  /** EPC de la puce RFID. Vide = la pièce ne porte qu'un code-barres. */
  rfidTag: z.string().trim().toUpperCase().nullish(),
});

export async function updateProduct(
  productId: string,
  input: z.input<typeof updateProductSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Champs invalides" };

  try {
    const session = await requirePermission(PERMISSIONS.inventaireModifier);
    const d = parsed.data;

    const { data: before, error: readError } = await session.supabase
      .from("products")
      .select("sku, name, description, showcase_slot, rfid_tag")
      .eq("id", productId)
      .single();

    if (readError) return { ok: false, error: readError.message };

    const patch = {
      ...(d.name !== undefined && { name: d.name }),
      ...(d.description !== undefined && { description: d.description ?? null }),
      ...(d.showcaseSlot !== undefined && { showcase_slot: d.showcaseSlot ?? null }),
      ...(d.rfidTag !== undefined && { rfid_tag: d.rfidTag || null }),
    };

    const { error } = await session.supabase
      .from("products")
      .update(patch)
      .eq("id", productId);

    if (error) return { ok: false, error: error.message };

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Fiche ${before.sku} modifiée`,
      entityType: "product",
      entityId: productId,
      entityLabel: `${before.name} · ${before.sku}`,
      changes: diffOf(before as Record<string, unknown>, patch),
    });

    revalidatePath("/inventaire");
    revalidatePath(`/inventaire/${productId}`);
    return { ok: true, data: { id: productId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/** Remplace intégralement les matériaux : c'est la composition qui fait le prix. */
export async function replaceProductMaterials(
  productId: string,
  materials: z.input<typeof materialSchema>[],
): Promise<ActionResult<{ count: number }>> {
  const parsed = z.array(materialSchema).safeParse(materials);
  if (!parsed.success) {
    return { ok: false, error: "Composition invalide" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.inventaireModifier);

    const { error: deleteError } = await session.supabase
      .from("product_materials")
      .delete()
      .eq("product_id", productId);

    if (deleteError) return { ok: false, error: deleteError.message };

    if (parsed.data.length > 0) {
      const { error } = await session.supabase.from("product_materials").insert(
        parsed.data.map((m) => ({
          product_id: productId,
          metal_kind: m.metalKind,
          purity_per_mille: m.purityPerMille,
          color: m.color ?? null,
          weight_grams: m.weightGrams,
          detail: m.detail ?? null,
        })),
      );
      if (error) return { ok: false, error: error.message };
    }

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Composition métal revue : ${parsed.data
        .map((m) => `${m.weightGrams} g ${m.metalKind} ${m.purityPerMille} ‰`)
        .join(", ")}`,
      entityType: "product",
      entityId: productId,
    });

    revalidatePath(`/inventaire/${productId}`);
    return { ok: true, data: { count: parsed.data.length } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function setProductStatus(
  productId: string,
  status: ProductStatus,
): Promise<ActionResult<{ status: ProductStatus }>> {
  try {
    const session = await requirePermission(PERMISSIONS.inventaireStatut);

    const { data: before } = await session.supabase
      .from("products")
      .select("sku, name, status")
      .eq("id", productId)
      .single();

    const { error } = await session.supabase.rpc("set_product_status", {
      product_id_param: productId,
      status_param: status,
    });

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "produit_statut",
      summary: `${before?.sku ?? "Pièce"} : ${PRODUCT_STATUS_LABELS[before?.status ?? "en_stock"]} → ${PRODUCT_STATUS_LABELS[status]}`,
      entityType: "product",
      entityId: productId,
      entityLabel: before ? `${before.name} · ${before.sku}` : undefined,
      changes: { avant: { statut: before?.status ?? null }, apres: { statut: status } },
    });

    revalidatePath("/inventaire");
    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/dashboard");
    return { ok: true, data: { status } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Une pièce déjà facturée ne peut pas disparaître : la clé étrangère de
 * `transaction_items` la retient, conservation comptable oblige.
 */
export async function deleteProduct(
  productId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.inventaireSupprimer);

    const { data: before } = await session.supabase
      .from("products")
      .select("sku, name")
      .eq("id", productId)
      .single();

    const { count } = await session.supabase
      .from("transaction_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error:
          "Cette pièce figure sur une vente : suppression interdite (conservation 7 ans). Retirez-la de la vitrine à la place.",
      };
    }

    const { error } = await session.supabase.from("products").delete().eq("id", productId);
    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "produit_supprime",
      summary: `Pièce ${before?.sku ?? productId} supprimée définitivement`,
      entityType: "product",
      entityId: productId,
      entityLabel: before ? `${before.name} · ${before.sku}` : undefined,
    });

    revalidatePath("/inventaire");
    return { ok: true, data: { id: productId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
