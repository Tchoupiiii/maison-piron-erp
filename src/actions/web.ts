"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { diffOf, logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { revalidateSite, slugify } from "@/lib/web-site";
import { actionError, type ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type ProductCategory = Database["public"]["Enums"]["product_category"];
type ProductUnivers = Database["public"]["Enums"]["product_univers"];

/* --------------------------------------------------------------------------
   Fiche « Site web » d'une pièce
   -------------------------------------------------------------------------- */

const webFieldsSchema = z.object({
  brandId: z.string().uuid().nullish(),
  category: z.string().trim().nullish(),
  univers: z.string().trim().nullish(),
  /** Vide = dérivé du nom. Une fois publié, le changer casse les liens. */
  slug: z.string().trim().nullish(),
  description: z.string().trim().nullish(),
  supplyMode: z.enum(["stock", "sur_demande"]).default("stock"),
  isPieceUnique: z.boolean().default(false),
  sort: z.number().int().min(0).max(9999).nullish(),
});

export async function updateProductWeb(
  productId: string,
  input: z.input<typeof webFieldsSchema>,
): Promise<ActionResult<{ slug: string | null }>> {
  if (!z.string().uuid().safeParse(productId).success) {
    return { ok: false, error: "Pièce introuvable" };
  }
  const parsed = webFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Champs de vitrine invalides" };

  try {
    const session = await requirePermission(PERMISSIONS.webPublier);
    const d = parsed.data;

    const { data: before, error: readError } = await session.supabase
      .from("products")
      .select(
        "sku, name, brand_id, category, univers, web_slug, web_description, web_published, supply_mode, is_piece_unique, web_sort",
      )
      .eq("id", productId)
      .single();
    if (readError) return { ok: false, error: readError.message };

    // Le slug n'est dérivé qu'à la première saisie : une pièce déjà en ligne
    // garde son URL, même renommée. C'est l'adresse partagée par le client.
    const slug = d.slug ? slugify(d.slug) : (before.web_slug ?? slugify(before.name));
    if (!slug) return { ok: false, error: "Le nom ne donne aucune adresse lisible : saisissez un slug." };

    const patch = {
      brand_id: d.brandId || null,
      category: (d.category || null) as ProductCategory | null,
      univers: (d.univers || null) as ProductUnivers | null,
      web_slug: slug,
      web_description: d.description || null,
      supply_mode: d.supplyMode,
      is_piece_unique: d.isPieceUnique,
      web_sort: d.sort ?? null,
    };

    const { error } = await session.supabase.from("products").update(patch).eq("id", productId);
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? `L'adresse « ${slug} » est déjà prise par une autre pièce.`
            : error.message,
      };
    }

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Vitrine web de ${before.sku} mise à jour`,
      entityType: "product",
      entityId: productId,
      entityLabel: `${before.name} · ${before.sku}`,
      changes: diffOf(before as Record<string, unknown>, patch),
    });

    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/inventaire");
    if (before.web_published) {
      await revalidateSite([`/piece/${slug}`, ...(before.web_slug && before.web_slug !== slug ? [`/piece/${before.web_slug}`] : [])]);
    }
    return { ok: true, data: { slug } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Publier n'est pas un champ de plus : c'est le geste qui rend une pièce, son
 * prix et ses photos visibles de tous. D'où une action à part, et le refus de
 * publier une fiche incomplète — le site n'a pas à afficher une carte vide.
 */
export async function setWebPublication(
  productId: string,
  published: boolean,
): Promise<ActionResult<{ published: boolean }>> {
  if (!z.string().uuid().safeParse(productId).success) {
    return { ok: false, error: "Pièce introuvable" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.webPublier);

    const { data: product, error: readError } = await session.supabase
      .from("products")
      .select("sku, name, status, web_slug, category, univers, cached_ttc")
      .eq("id", productId)
      .single();
    if (readError) return { ok: false, error: readError.message };

    if (published) {
      const missing: string[] = [];
      if (!product.web_slug) missing.push("adresse (slug)");
      if (!product.category) missing.push("catégorie");
      if (!product.univers) missing.push("univers");
      if (product.cached_ttc === null) missing.push("prix calculé");
      if (missing.length > 0) {
        return {
          ok: false,
          error: `Fiche incomplète pour la vitrine : ${missing.join(", ")}.`,
        };
      }
      if (product.status === "vendu") {
        return {
          ok: false,
          error:
            "Cette pièce est vendue. Publiée, elle s'afficherait en ligne comme « Vendue » — dépubliez plutôt, ou publiez la pièce qui la remplace.",
        };
      }
    }

    const { error } = await session.supabase
      .from("products")
      .update({ web_published: published })
      .eq("id", productId);
    if (error) return { ok: false, error: error.message };

    await logActivity(session, {
      action: "web_produit_publie",
      summary: `${product.sku} ${published ? "publiée sur le site" : "retirée du site"}`,
      entityType: "product",
      entityId: productId,
      entityLabel: `${product.name} · ${product.sku}`,
    });

    revalidatePath(`/inventaire/${productId}`);
    revalidatePath("/inventaire");
    await revalidateSite(["/", `/piece/${product.web_slug}`, "/collections", "/maisons"]);
    return { ok: true, data: { published } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/* --------------------------------------------------------------------------
   Photos de vitrine
   -------------------------------------------------------------------------- */

const WEB_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Le type annoncé par le navigateur n'engage personne : un POST direct sur la
 * Server Action déclare ce qu'il veut. Le bucket est **public** — un fichier
 * mal typé y serait servi tel quel à tout internaute. On lit les octets.
 */
const WEB_IMAGE_FORMATS = [
  { mime: "image/jpeg", extension: "jpg", head: [0xff, 0xd8, 0xff] },
  { mime: "image/png", extension: "png", head: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", extension: "webp", head: [0x52, 0x49, 0x46, 0x46] }, // RIFF…WEBP
] as const;

async function sniffWebImage(file: File) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const format = WEB_IMAGE_FORMATS.find((f) => f.head.every((b, i) => head[i] === b));
  if (!format) return undefined;
  // RIFF sert aussi aux .wav : seul le marqueur WEBP tranche.
  if (format.extension === "webp") {
    const tag = String.fromCharCode(...head.slice(8, 12));
    if (tag !== "WEBP") return undefined;
  }
  return format;
}

const WEB_MEDIA_TYPES = ["packshot", "profil", "porte", "macro"] as const;

export async function uploadWebMedia(
  productId: string,
  formData: FormData,
): Promise<ActionResult<{ mediaId: string }>> {
  if (!z.string().uuid().safeParse(productId).success) {
    return { ok: false, error: "Pièce introuvable" };
  }

  const mediaType = String(formData.get("mediaType") ?? "");
  if (!(WEB_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return { ok: false, error: "Vue inconnue" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choisissez une image" };
  }
  if (file.size > WEB_MEDIA_MAX_BYTES) {
    return { ok: false, error: "Image trop lourde (8 Mo maximum)" };
  }

  const format = await sniffWebImage(file);
  if (!format) return { ok: false, error: "Formats acceptés : JPEG, PNG, WebP" };

  try {
    const session = await requirePermission(PERMISSIONS.webPublier);

    const { data: product } = await session.supabase
      .from("products")
      .select("sku, name, web_slug, web_published")
      .eq("id", productId)
      .maybeSingle();
    if (!product) return { ok: false, error: "Pièce introuvable" };

    const storagePath = `${productId}/${mediaType}-${crypto.randomUUID()}.${format.extension}`;

    const { error: uploadError } = await session.supabase.storage
      .from("web_media")
      .upload(storagePath, file, { contentType: format.mime, cacheControl: "31536000" });
    if (uploadError) return { ok: false, error: uploadError.message };

    const { data: media, error } = await session.supabase
      .from("product_media")
      .insert({
        product_id: productId,
        media_type: mediaType as Database["public"]["Enums"]["media_type"],
        storage_path: storagePath,
        bucket_id: "web_media",
        position: WEB_MEDIA_TYPES.indexOf(mediaType as (typeof WEB_MEDIA_TYPES)[number]),
      })
      .select("id")
      .single();

    if (error) {
      await session.supabase.storage.from("web_media").remove([storagePath]);
      return { ok: false, error: error.message };
    }

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Photo web (${mediaType}) ajoutée à ${product.sku}`,
      entityType: "product",
      entityId: productId,
    });

    revalidatePath(`/inventaire/${productId}`);
    if (product.web_published && product.web_slug) {
      await revalidateSite([`/piece/${product.web_slug}`, "/"]);
    }
    return { ok: true, data: { mediaId: media.id } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function deleteWebMedia(mediaId: string): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(mediaId).success) {
    return { ok: false, error: "Image introuvable" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.webPublier);

    const { data: media } = await session.supabase
      .from("product_media")
      .select("id, product_id, storage_path, products(sku, web_slug, web_published)")
      .eq("id", mediaId)
      .eq("bucket_id", "web_media")
      .maybeSingle();
    if (!media) return { ok: false, error: "Image introuvable" };

    // Le fichier part en premier : le bucket est public, une ligne supprimée
    // sans son objet laisserait l'image accessible par son URL.
    // Un refus de policy ne lève pas d'erreur, il ne retire rien — c'est le
    // tableau renvoyé qui fait foi.
    const { data: removed, error: storageError } = await session.supabase.storage
      .from("web_media")
      .remove([media.storage_path]);
    if (storageError || !removed || removed.length === 0) {
      return {
        ok: false,
        error: `Image non supprimée du stockage${
          storageError ? ` : ${storageError.message}` : ", droits insuffisants"
        }. Elle resterait visible par son adresse.`,
      };
    }

    const { error } = await session.supabase.from("product_media").delete().eq("id", mediaId);
    if (error) return { ok: false, error: error.message };

    await logActivity(session, {
      action: "produit_modifie",
      summary: `Photo web retirée (${media.products?.sku ?? media.product_id})`,
      entityType: "product",
      entityId: media.product_id,
    });

    revalidatePath(`/inventaire/${media.product_id}`);
    if (media.products?.web_published && media.products.web_slug) {
      await revalidateSite([`/piece/${media.products.web_slug}`, "/"]);
    }
    return { ok: true, data: { id: mediaId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/* --------------------------------------------------------------------------
   Maisons représentées
   -------------------------------------------------------------------------- */

const brandSchema = z.object({
  name: z.string().trim().min(2, "Nommez la maison"),
  slug: z.string().trim().nullish(),
  kind: z.string().trim().min(2, "Précisez la spécialité"),
  blurb: z.string().trim().nullish(),
  sort: z.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
});

export async function saveBrand(
  brandId: string | null,
  input: z.input<typeof brandSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Fiche maison incomplète",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.webMarques);
    const d = parsed.data;
    const slug = slugify(d.slug || d.name);
    if (!slug) return { ok: false, error: "Le nom ne donne aucune adresse lisible." };

    const patch = {
      name: d.name,
      slug,
      kind: d.kind,
      blurb: d.blurb || null,
      sort: d.sort,
      is_active: d.isActive,
    };

    const query = brandId
      ? session.supabase.from("brands").update(patch).eq("id", brandId).select("id").single()
      : session.supabase.from("brands").insert(patch).select("id").single();

    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "Une maison porte déjà ce nom ou cette adresse."
            : error.message,
      };
    }

    await logActivity(session, {
      action: "web_marque_modifiee",
      summary: `Maison ${d.name} ${brandId ? "modifiée" : "ajoutée"}`,
      entityType: "brand",
      entityId: data.id,
      entityLabel: d.name,
    });

    revalidatePath("/reglages");
    await revalidateSite(["/maisons", `/maisons/${slug}`]);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Une maison n'est jamais supprimée : des pièces vendues y renvoient, et le
 * site garde ses URL. On la désactive — elle sort de la navigation, ses pièces
 * publiées restent lisibles.
 */
export async function setBrandActive(
  brandId: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(brandId).success) {
    return { ok: false, error: "Maison introuvable" };
  }

  try {
    const session = await requirePermission(PERMISSIONS.webMarques);

    const { data: before } = await session.supabase
      .from("brands")
      .select("name, slug")
      .eq("id", brandId)
      .maybeSingle();
    if (!before) return { ok: false, error: "Maison introuvable" };

    const { error } = await session.supabase
      .from("brands")
      .update({ is_active: isActive })
      .eq("id", brandId);
    if (error) return { ok: false, error: error.message };

    await logActivity(session, {
      action: "web_marque_modifiee",
      summary: `Maison ${before.name} ${isActive ? "réactivée" : "masquée du site"}`,
      entityType: "brand",
      entityId: brandId,
      entityLabel: before.name,
    });

    revalidatePath("/reglages");
    await revalidateSite(["/maisons", `/maisons/${before.slug}`]);
    return { ok: true, data: { id: brandId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
