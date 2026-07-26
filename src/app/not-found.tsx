import Link from "next/link";
import { buttonPrimary } from "@/components/ui";
import { getMaison } from "@/lib/maison";

export default async function NotFound() {
  const maison = await getMaison();
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-card border border-hairline bg-paper p-8 shadow-card">
        <div className="flex flex-col gap-2">
          <span className="tabular text-caption uppercase tracking-[0.6px] text-mid-gray">
            Erreur 404
          </span>
          <h1 className="text-heading font-semibold">Page introuvable</h1>
          <p className="text-body text-mid-gray">
            Cette adresse ne correspond à aucun écran de l&apos;ERP. Le lien est
            peut-être ancien, ou la pièce a été retirée du catalogue.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className={buttonPrimary}>
            Tableau de bord
          </Link>
        </div>

        <p className="border-t border-hairline pt-4 text-caption text-mid-gray">
          {maison.legalName} · {maison.street}, {maison.postalCode} {maison.city}
        </p>
      </div>
    </main>
  );
}
