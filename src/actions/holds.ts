"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";

/**
 * Vider un panier depuis Réglages, plutôt que depuis la caisse qui l'a ouvert :
 * une cliente partie sans prévenir, une caisse plantée avant `caisse fermée`.
 * `release_hold` fait déjà le travail — cette action y ajoute la garde admin
 * et une ligne de journal distincte, pour qu'un retrait forcé se distingue
 * d'un abandon normal.
 */
export async function releaseHoldAdmin(
  cartRef: string,
  productId: string | null,
  productLabel: string,
): Promise<ActionResult<{ count: number }>> {
  const parsed = z.string().trim().min(1).safeParse(cartRef);
  if (!parsed.success) return { ok: false, error: "Panier introuvable" };

  try {
    const session = await requirePermission(PERMISSIONS.systemeCaisses);

    const { data: count, error } = await session.supabase.rpc("release_hold", {
      cart_ref_param: parsed.data,
      product_id_param: productId ?? undefined,
      reason_param: "libéré par un administrateur",
    });
    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "panier_libere",
      summary: productId
        ? `${productLabel} retirée du panier ${cartRef} par un administrateur`
        : `Panier ${cartRef} entièrement vidé par un administrateur`,
      entityType: "stock_hold",
      entityId: productId ?? undefined,
    });

    revalidatePath("/reglages");
    return { ok: true, data: { count: count ?? 0 } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
