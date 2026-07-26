import { headers } from "next/headers";
import type { StaffSession } from "@/actions/auth-guard";
import type { Database, Json } from "@/types/database.types";

type ActivityAction = Database["public"]["Enums"]["activity_action"];

/**
 * Derrière Vercel, l'adresse réelle est en tête de `x-forwarded-for`.
 * La base refuse silencieusement une valeur non analysable, mais autant ne
 * transmettre que le premier saut.
 */
export async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

type LogInput = {
  action: ActivityAction;
  summary: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  changes?: Json;
};

/**
 * Le journal passe par `log_activity`, seule voie d'écriture : la base estampille
 * elle-même l'auteur, donc une ligne ne peut pas être forgée depuis le client.
 * Un échec de journalisation ne doit jamais annuler l'action métier déjà faite.
 */
export async function logActivity(
  session: Pick<StaffSession, "supabase">,
  input: LogInput,
): Promise<void> {
  try {
    const { ip, userAgent } = await requestOrigin();
    await session.supabase.rpc("log_activity", {
      action_param: input.action,
      summary_param: input.summary,
      entity_type_param: input.entityType ?? undefined,
      entity_id_param: input.entityId ?? undefined,
      entity_label_param: input.entityLabel ?? undefined,
      changes_param: input.changes ?? undefined,
      ip_param: ip ?? undefined,
      user_agent_param: userAgent ?? undefined,
    });
  } catch {
    // journal indisponible : l'opération métier reste valide
  }
}

/** Ne garde que les champs réellement modifiés, pour un journal lisible. */
export function diffOf<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Json | undefined {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && before[key] !== value) {
      from[key] = before[key] ?? null;
      to[key] = value;
    }
  }

  if (Object.keys(to).length === 0) return undefined;
  return { avant: from, apres: to } as Json;
}
