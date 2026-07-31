/**
 * Ponts vers le site public (`Site Web/web`, port 3002 en local).
 *
 * Le site met ses pages en cache (ISR). Publier une pièce depuis l'ERP ne se
 * voit donc pas avant l'expiration du cache — d'où l'appel d'invalidation.
 * Sans `WEB_SITE_URL` / `REVALIDATE_SECRET`, on ne fait rien : le site
 * rattrapera de lui-même au bout d'une minute, ce n'est pas un échec.
 */

/** `Bague Perron · 18 ct` → `bague-perron-18-ct`. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function revalidateSite(paths: string[]): Promise<void> {
  const base = process.env.WEB_SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!base || !secret || paths.length === 0) return;

  try {
    await fetch(`${base.replace(/\/$/, "")}/api/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ paths }),
      // Le site indisponible ne doit pas bloquer une publication en boutique.
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // cache non invalidé : le site rattrapera à l'expiration de l'ISR
  }
}
