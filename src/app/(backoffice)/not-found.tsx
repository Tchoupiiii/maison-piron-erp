import Link from "next/link";
import { PageHeader, Section, buttonPrimary } from "@/components/ui";
import { getMaison } from "@/lib/maison";

export default async function BackofficeNotFound() {
  const maison = await getMaison();
  return (
    <>
      <PageHeader breadcrumb={[maison.displayName, "Erreur 404"]} title="Page introuvable" />
      <Section>
        <div className="flex max-w-lg flex-col gap-4 rounded-card border border-hairline bg-paper p-5 shadow-card">
          <p className="text-body text-mid-gray">
            Cet écran n&apos;existe pas — ou la fiche demandée a été supprimée du
            catalogue. Vérifiez le lien, ou repartez du tableau de bord.
          </p>
          <div>
            <Link href="/dashboard" className={buttonPrimary}>
              Tableau de bord
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
