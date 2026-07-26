"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/actions/auth-guard";
import { logActivity } from "@/actions/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { actionError, type ActionResult } from "@/actions/types";

const terminalSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code trop court")
    .regex(/^[A-Za-z0-9-]+$/, "Lettres, chiffres et tirets uniquement"),
  name: z.string().trim().min(2, "Nommez la caisse"),
  location: z.string().trim().nullish(),
  receiptFormat: z.enum(["thermique_80", "thermique_58", "a4"]).default("thermique_80"),
  scannerMode: z.enum(["clavier", "camera", "rfid"]).default("clavier"),
});

export async function createTerminal(
  input: z.input<typeof terminalSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = terminalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Formulaire incomplet",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const session = await requirePermission(PERMISSIONS.systemeCaisses);
    const d = parsed.data;

    const { data, error } = await session.supabase
      .from("pos_terminals")
      .insert({
        code: d.code.toUpperCase(),
        name: d.name,
        location: d.location?.trim() || null,
        receipt_format: d.receiptFormat,
        scanner_mode: d.scannerMode,
      })
      .select("id, code, name")
      .single();

    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Ce code de caisse existe déjà" : error.message,
      };
    }

    await logActivity(session, {
      action: "caisse_creee",
      summary: `Caisse ${data.code} ajoutée · ticket ${d.receiptFormat}, scanner ${d.scannerMode}`,
      entityType: "pos_terminal",
      entityId: data.id,
      entityLabel: data.name,
    });

    revalidatePath("/reglages");
    revalidatePath("/pos");
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}

export async function updateTerminal(
  terminalId: string,
  input: Partial<z.input<typeof terminalSchema>> & { isActive?: boolean },
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.systemeCaisses);

    const { data: before } = await session.supabase
      .from("pos_terminals")
      .select("code, name, is_active, receipt_format, scanner_mode")
      .eq("id", terminalId)
      .single();

    const patch = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.location !== undefined && { location: input.location?.trim() || null }),
      ...(input.receiptFormat !== undefined && { receipt_format: input.receiptFormat }),
      ...(input.scannerMode !== undefined && { scanner_mode: input.scannerMode }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
    };

    const { error } = await session.supabase
      .from("pos_terminals")
      .update(patch)
      .eq("id", terminalId);

    if (error) return { ok: false, error: actionError(error) };

    await logActivity(session, {
      action: "caisse_modifiee",
      summary: `Caisse ${before?.code ?? terminalId} modifiée`,
      entityType: "pos_terminal",
      entityId: terminalId,
      entityLabel: before?.name,
      changes: { avant: before, apres: patch },
    });

    revalidatePath("/reglages");
    revalidatePath("/pos");
    return { ok: true, data: { id: terminalId } };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
