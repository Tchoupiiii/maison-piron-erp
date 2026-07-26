import Link from "next/link";
import { getStaffSession } from "@/actions/auth-guard";
import { SignOutButton } from "@/components/sign-out-button";
import { getMaison } from "@/lib/maison";

/**
 * Chrome tactile du point de vente : pas de sidebar, cibles ≥44 px.
 * Même app, mêmes Server Actions que le back-office — un seul moteur de prix.
 * `print:hidden` retire la coquille à l'impression du ticket.
 */
export default async function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Une session Supabase ne suffit pas : il faut une fiche employé active, comme
  // au back-office. La RLS refuserait déjà les données, mais autant le dire ici
  // plutôt que d'afficher une caisse vide.
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-card border border-hairline bg-paper p-5 shadow-card">
          <h1 className="text-subheading font-medium">Accès refusé</h1>
          <p className="text-body text-mid-gray">
            Ce compte n&apos;a pas de fiche employé active. Un administrateur doit
            l&apos;activer depuis Réglages → Employés.
          </p>
          <SignOutButton />
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas print:min-h-0 print:bg-white">
      <header className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-4 print:hidden">
        <div className="flex flex-col">
          <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">
            {maison.legalName}
          </span>
          <span className="text-heading-sm font-semibold">Point de vente</span>
        </div>
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center rounded-pill border border-hairline px-4 text-body font-medium"
        >
          Back-office
        </Link>
      </header>
      <main className="flex-1 p-6 print:p-0">{children}</main>
    </div>
  );
}
