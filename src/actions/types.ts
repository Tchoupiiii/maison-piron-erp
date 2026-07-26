export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Message lisible pour l'utilisateur à partir d'une erreur Postgres ou JS. */
export function actionError(error: unknown): string {
  const message = (error as Error)?.message ?? "Erreur inattendue";
  return message.replace(/^ERROR:\s*/i, "");
}
