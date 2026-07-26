"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { diffOf, logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { PRODUCT_STATUS_LABELS } from "@/lib/constants";
import { actionError, type ActionResult } from "@/actions/types";
import { computeAndPersist } from "@/lib/pricing/persist";
import type { StaffSession } from "@/actions/auth-guard";
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

/**
 * Après toute écriture sur les pierres, l'étiquette doit suivre — mais le
 * recalcul exige `inventaire.prix`. Sans ce droit, la pierre est bien
 * enregistrée et l'UI invite à faire recalculer le prix.
 */
async function recalcIfAllowed(session: StaffSession, productId: string): Promise<boolean> {
  if (!session.can(PERMISSIONS.inventairePrix)) return false;
  await computeAndPersist(session, productId, "edition_manuelle");
  return true;
}

export async function addGemstone(
  productId: string,
  input: z.input<typeof gemstoneSchema>,
): Promise<ActionResult<{ id: string; priceRecalculated: boolean }>> {
  if (!z.string().uuid().safeParse(productId).success) {
    return { ok: false, error: "Pièce introuvable" };
  }
  const parsed = gemstoneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Pierre incomplète",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.inventaireModifier);
    const g = parsed.data;

    const { data: gemstone, error } = await session.supabase
      .from("product_gemstones")
      .insert({
        product_id: productId,
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
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };

    const priceRecalculated = await recalcIfAllowed(session, productId);

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Pierre ajoutée : ${g.name} (${g.stoneCount} × ${g.caratWeight} ct)`,
      entityType: "product",
      entityId: productId,
    });

    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/inventaire");
    return { ok: true, data: { id: gemstone.id, priceRecalculated } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function updateGemstone(
  productId: string,
  gemstoneId: string,
  input: z.input<typeof gemstoneSchema>,
): Promise<ActionResult<{ id: string; priceRecalculated: boolean }>> {
  const target = certificateTargetSchema.safeParse({ productId, gemstoneId });
  if (!target.success) return { ok: false, error: "Pierre introuvable" };
  const parsed = gemstoneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Pierre incomplète",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.inventaireModifier);
    const g = parsed.data;

    // Jamais de delete+insert : l'id doit survivre, les certificats scannés
    // (`product_media.gemstone_id`, on delete cascade) en dépendent.
    const { data: updated, error } = await session.supabase
      .from("product_gemstones")
      .update({
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
      })
      .eq("id", gemstoneId)
      .eq("product_id", productId)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!updated) return { ok: false, error: "Pierre introuvable" };

    const priceRecalculated = await recalcIfAllowed(session, productId);

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Pierre modifiée : ${g.name} (${g.stoneCount} × ${g.caratWeight} ct)`,
      entityType: "product",
      entityId: productId,
    });

    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/inventaire");
    return { ok: true, data: { id: gemstoneId, priceRecalculated } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function removeGemstone(
  productId: string,
  gemstoneId: string,
): Promise<ActionResult<{ id: string; priceRecalculated: boolean }>> {
  const target = certificateTargetSchema.safeParse({ productId, gemstoneId });
  if (!target.success) return { ok: false, error: "Pierre introuvable" };

  try {
    const session = await requirePermission(PERMISSIONS.inventaireModifier);

    const { data: gemstone } = await session.supabase
      .from("product_gemstones")
      .select("id, name")
      .eq("id", gemstoneId)
      .eq("product_id", productId)
      .maybeSingle();
    if (!gemstone) return { ok: false, error: "Pierre introuvable" };

    // Les scans de certificats partent en premier (même règle que
    // deleteGemstoneCertificate) : la cascade SQL supprimerait les lignes
    // media mais laisserait les fichiers orphelins dans le bucket.
    const { data: mediaRows } = await session.supabase
      .from("product_media")
      .select("storage_path")
      .eq("gemstone_id", gemstoneId)
      .eq("media_type", "certificat");

    const paths = (mediaRows ?? []).map((m) => m.storage_path);
    if (paths.length > 0) {
      const { data: removed, error: storageError } = await session.supabase.storage
        .from("produit_media")
        .remove(paths);
      if (storageError || !removed || removed.length !== paths.length) {
        return {
          ok: false,
          error: `Certificat(s) scanné(s) non supprimés du stockage${
            storageError ? ` : ${storageError.message}` : " — droits insuffisants (inventaire.supprimer requis)"
          }. La pierre n'a pas été retirée.`,
        };
      }
    }

    const { error: deleteError } = await session.supabase
      .from("product_gemstones")
      .delete()
      .eq("id", gemstoneId)
      .eq("product_id", productId);
    if (deleteError) return { ok: false, error: deleteError.message };

    const priceRecalculated = await recalcIfAllowed(session, productId);

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Pierre retirée : ${gemstone.name}${paths.length > 0 ? ` (+ ${paths.length} certificat(s) scanné(s))` : ""}`,
      entityType: "product",
      entityId: productId,
    });

    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/inventaire");
    return { ok: true, data: { id: gemstoneId, priceRecalculated } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

const CERTIFICATE_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Le type annoncé par le navigateur n'engage personne : un POST direct sur la
 * Server Action déclare ce qu'il veut. Seuls les premiers octets disent ce
 * qu'est vraiment le fichier, alors on les lit.
 */
const CERTIFICATE_FORMATS = [
  { mime: "application/pdf", extension: "pdf", signature: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  { mime: "image/png", extension: "png", signature: [0x89, 0x50, 0x4e, 0x47] },
] as const;

async function sniffCertificateFormat(file: File) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return CERTIFICATE_FORMATS.find((format) =>
    format.signature.every((byte, index) => head[index] === byte),
  );
}

const certificateTargetSchema = z.object({
  productId: z.string().uuid(),
  gemstoneId: z.string().uuid(),
});

/**
 * Le scan du certificat (PDF/photo) est un fichier attaché à la pierre, distinct
 * de la page imprimable Maison Piron : ici on conserve le document du labo tel quel.
 */
export async function uploadGemstoneCertificate(
  productId: string,
  gemstoneId: string,
  formData: FormData,
): Promise<ActionResult<{ mediaId: string }>> {
  const target = certificateTargetSchema.safeParse({ productId, gemstoneId });
  if (!target.success) return { ok: false, error: "Pierre introuvable" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choisissez un fichier" };
  }
  if (file.size > CERTIFICATE_MAX_BYTES) {
    return { ok: false, error: "Fichier trop lourd (15 Mo maximum)" };
  }

  const format = await sniffCertificateFormat(file);
  if (!format) {
    return { ok: false, error: "Formats acceptés : PDF, JPEG, PNG" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.inventaireModifier);

    const { data: gemstone } = await session.supabase
      .from("product_gemstones")
      .select("id, name, product_id, products(sku)")
      .eq("id", gemstoneId)
      .eq("product_id", productId)
      .maybeSingle();
    if (!gemstone) return { ok: false, error: "Pierre introuvable" };

    const storagePath = `${productId}/certificats/${gemstoneId}/${crypto.randomUUID()}.${format.extension}`;

    // Le type stocké vient de la signature lue, jamais de ce qu'annonce le
    // client : un fichier ne peut pas être servi sous une autre nature que la
    // sienne.
    const { error: uploadError } = await session.supabase.storage
      .from("produit_media")
      .upload(storagePath, file, { contentType: format.mime });
    if (uploadError) return { ok: false, error: uploadError.message };

    const { data: media, error } = await session.supabase
      .from("product_media")
      .insert({
        product_id: productId,
        gemstone_id: gemstoneId,
        media_type: "certificat",
        storage_path: storagePath,
      })
      .select("id")
      .single();

    if (error) {
      await session.supabase.storage.from("produit_media").remove([storagePath]);
      return { ok: false, error: error.message };
    }

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Certificat scanné ajouté pour ${gemstone.name} (${gemstone.products?.sku ?? productId})`,
      entityType: "product",
      entityId: productId,
    });

    revalidatePath(`/inventaire/${productId}`);
    return { ok: true, data: { mediaId: media.id } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Supprimer le scan exige `inventaire.supprimer`, comme la policy Storage qui
 * garde le bucket : avec `inventaire.modifier` seul, la ligne disparaissait et
 * le fichier restait — l'action annonçait pourtant une suppression faite.
 */
export async function deleteGemstoneCertificate(
  mediaId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(mediaId).success) {
    return { ok: false, error: "Fichier introuvable" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.inventaireSupprimer);

    const { data: media } = await session.supabase
      .from("product_media")
      .select("id, product_id, storage_path, gemstone_id, product_gemstones(name)")
      .eq("id", mediaId)
      .eq("media_type", "certificat")
      .maybeSingle();
    if (!media) return { ok: false, error: "Fichier introuvable" };

    // Le fichier part en premier : c'est lui le document sensible. Une ligne
    // orpheline se répare, un scan qu'on croit effacé ne se rattrape pas.
    // Un refus de la policy Storage ne lève pas d'erreur, il ne retire
    // simplement rien : c'est le tableau renvoyé qui fait foi.
    const { data: removed, error: storageError } = await session.supabase.storage
      .from("produit_media")
      .remove([media.storage_path]);
    if (storageError || !removed || removed.length === 0) {
      return {
        ok: false,
        error: `Fichier non supprimé du stockage${
          storageError ? ` : ${storageError.message}` : ", droits insuffisants"
        }. La fiche n'a pas été modifiée.`,
      };
    }

    const { error: deleteError } = await session.supabase
      .from("product_media")
      .delete()
      .eq("id", mediaId);
    if (deleteError) return { ok: false, error: deleteError.message };

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Certificat scanné retiré (${media.product_gemstones?.name ?? "pierre"})`,
      entityType: "product",
      entityId: media.product_id,
    });

    revalidatePath(`/inventaire/${media.product_id}`);
    return { ok: true, data: { id: mediaId } };
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
