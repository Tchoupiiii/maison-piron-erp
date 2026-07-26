"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/actions/auth-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";

export type ScannedLine = {
  productId: string;
  sku: string;
  name: string;
  priceTtc: number;
  holdExpiresAt: string;
};

/**
 * Le geste du scan : code-barres ou puce RFID, en boutique ou en ligne.
 *
 * La pièce est **réservée**, pas vendue : le stock ne bouge qu'à l'encaissement.
 * Si une autre caisse ou le site l'a déjà dans son panier, la base refuse — et
 * c'est bien la base qui refuse, pas cet écran, sinon deux navigateurs
 * pourraient vendre la même pièce.
 */
export async function scanProduct(
  code: string,
  cartRef: string,
  terminalId: string | null,
): Promise<ActionResult<ScannedLine>> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Aucun code scanné" };

  try {
    const session = await requirePermission(PERMISSIONS.ventesCreer);

    const { data, error } = await session.supabase.rpc("scan_product", {
      code_param: trimmed,
      cart_ref_param: cartRef,
      channel_param: "boutique",
      terminal_id_param: terminalId ?? undefined,
      minutes_param: 30,
    });

    if (error) return { ok: false, error: error.message };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: "Pièce introuvable" };

    revalidatePath("/pos");
    return {
      ok: true,
      data: {
        productId: row.product_id,
        sku: row.sku,
        name: row.name,
        priceTtc: row.price_ttc,
        holdExpiresAt: row.hold_expires_at,
      },
    };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

/**
 * Retire une pièce du panier, ou vide le panier entier si `productId` est nul.
 * Rien n'est « remis » en stock : le stock n'avait pas bougé. La pièce
 * redevient simplement disponible, ici comme sur le site.
 */
export async function releaseHold(
  cartRef: string,
  productId: string | null,
  reason = "abandon",
): Promise<ActionResult<{ released: number }>> {
  try {
    const session = await requirePermission(PERMISSIONS.ventesCreer);

    const { data, error } = await session.supabase.rpc("release_hold", {
      cart_ref_param: cartRef,
      product_id_param: productId ?? undefined,
      reason_param: reason,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath("/pos");
    return { ok: true, data: { released: data ?? 0 } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
