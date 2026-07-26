import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { formatEUR } from "@/lib/constants";
import { ratePerGramForPurity } from "@/lib/pricing/engine";
import { NAV_ITEMS, STAFF_ROLE_LABELS } from "@/lib/permissions";

export default async function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.is_active) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-card border border-hairline bg-paper p-5 shadow-card">
          <h1 className="text-subheading font-medium">
            {staff ? "Compte désactivé" : "Compte non rattaché"}
          </h1>
          <p className="text-body text-mid-gray">
            {staff
              ? "Cet accès a été suspendu par un administrateur. Aucune donnée de la boutique n'est visible."
              : "Ce compte n'a pas de fiche employé. Un administrateur doit le créer depuis Réglages → Employés avant l'accès aux données."}
          </p>
          <SignOutButton />
        </div>
      </main>
    );
  }

  const { data: permissionKeys } = await supabase.rpc("my_permissions");
  const permissions = new Set<string>(permissionKeys ?? []);

  const navItems = NAV_ITEMS.filter(
    (item) => item.permission === null || permissions.has(item.permission),
  ).map(({ href, label }) => ({ href, label }));

  const { data: goldRate } = await supabase
    .from("market_rates")
    .select("price_eur_per_gram_fine, rate_date, source")
    .eq("metal_kind", "or")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const initials = staff.full_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    // À l'impression (certificat de pierre), la coquille disparaît : sans ça, le
    // document remis au client emporterait la navigation, le cours de l'or et le
    // nom de l'employé connecté.
    <div className="grid min-h-screen grid-cols-[248px_1fr] bg-canvas max-lg:grid-cols-1 print:block print:min-h-0 print:bg-white">
      <aside className="sticky top-0 flex h-screen flex-col gap-6 overflow-y-auto bg-surface-alt px-3 py-5 max-lg:static max-lg:h-auto print:hidden">
        <SidebarNav items={navItems} />

        <div className="mt-auto flex flex-col gap-3">
          {goldRate && (
            <div className="flex flex-col gap-2 rounded-card border border-hairline bg-paper p-5 shadow-card">
              <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">
                Or 18k · aujourd&apos;hui
              </span>
              <span className="tabular text-heading-sm font-medium">
                {formatEUR(
                  ratePerGramForPurity(goldRate.price_eur_per_gram_fine, 750),
                )}
              </span>
              <span className="text-caption text-mid-gray">
                par gramme · cours du {goldRate.rate_date}
                {goldRate.source === "seed" && " · données de démonstration"}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 px-[10px]">
            <div className="grid size-7 place-items-center rounded-pill bg-ink-soft text-caption font-medium text-surface-alt">
              {initials}
            </div>
            <div className="flex min-w-0 flex-col leading-[1.33]">
              <span className="truncate text-[13px] font-medium">{staff.full_name}</span>
              <span className="text-caption text-mid-gray">
                {STAFF_ROLE_LABELS[staff.role]}
              </span>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main className="flex min-w-0 flex-col">{children}</main>
    </div>
  );
}
