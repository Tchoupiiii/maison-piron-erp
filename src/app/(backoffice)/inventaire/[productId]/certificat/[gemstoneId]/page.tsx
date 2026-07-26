import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffSession } from "@/actions/auth-guard";
import { PrintButton } from "@/components/print-button";
import { buttonGhost } from "@/components/ui";
import { CERTIFICATE_LAB_LABELS, GEMSTONE_TYPE_LABELS } from "@/lib/constants";
import { getMaison } from "@/lib/maison";
import { PERMISSIONS } from "@/lib/permissions";
import { AccessRestricted } from "@/components/access-restricted";

/**
 * Document Maison Piron distinct du scan de labo : une mise en forme soignée
 * des caractéristiques gemmologiques, à remettre au client sans dépendre du
 * fichier original (voir la fiche pièce pour le scan attaché).
 */
export default async function GemstoneCertificatePage({
  params,
}: {
  params: Promise<{ productId: string; gemstoneId: string }>;
}) {
  const { productId, gemstoneId } = await params;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;
  if (!session.can(PERMISSIONS.inventaireVoir)) {
    return (
      <AccessRestricted
        breadcrumb={[maison.displayName, "Boutique", "Inventaire"]}
        title="Certificat"
        permissionLabel="Consulter l'inventaire"
      />
    );
  }

  const { data: gemstone } = await session.supabase
    .from("product_gemstones")
    .select(
      "id, name, gemstone_type, carat_weight, stone_count, clarity, color, cut, certificate_lab, certificate_number, products(sku, name)",
    )
    .eq("id", gemstoneId)
    .eq("product_id", productId)
    .maybeSingle();

  if (!gemstone) notFound();

  const issuedOn = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <style>{`@media print { @page { size: A4; margin: 20mm; } }`}</style>

      <article className="w-[210mm] max-w-full bg-paper p-12 text-ink print:w-full print:p-0">
        <header className="flex flex-col items-center gap-1 border-b-2 border-ink pb-6 text-center">
          <span className="text-heading-lg font-semibold">{maison.legalName}</span>
          <span className="text-body text-mid-gray">
            {maison.street} · {maison.postalCode} {maison.city} · {maison.country}
          </span>
          <span className="tabular text-caption text-mid-gray">{maison.vatNumber}</span>
        </header>

        <h1 className="pt-8 text-center text-heading font-semibold">
          Certificat de pierre
        </h1>
        <p className="pb-8 text-center text-body text-mid-gray">
          Établi le {issuedOn} pour la pièce {gemstone.products?.sku ?? productId}
          {gemstone.products?.name ? ` — ${gemstone.products.name}` : ""}
        </p>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-t border-hairline pt-6 text-body">
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">Désignation</dt>
            <dd className="font-medium">{gemstone.name}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">Type de pierre</dt>
            <dd className="font-medium">{GEMSTONE_TYPE_LABELS[gemstone.gemstone_type]}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">Poids</dt>
            <dd className="tabular font-medium">{gemstone.carat_weight} carats</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">Nombre de pierres</dt>
            <dd className="tabular font-medium">{gemstone.stone_count}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">Pureté</dt>
            <dd className="font-medium">{gemstone.clarity ?? "non renseignée"}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">Couleur</dt>
            <dd className="font-medium">{gemstone.color ?? "non renseignée"}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">Taille</dt>
            <dd className="font-medium">{gemstone.cut ?? "non renseignée"}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-caption uppercase tracking-[0.6px] text-mid-gray">
              Certificat de laboratoire
            </dt>
            <dd className="font-medium">
              {CERTIFICATE_LAB_LABELS[gemstone.certificate_lab]}
              {gemstone.certificate_number ? ` — n° ${gemstone.certificate_number}` : ""}
            </dd>
          </div>
        </dl>

        <footer className="mt-12 border-t border-hairline pt-6 text-caption text-mid-gray">
          <p>
            Ce document décrit les caractéristiques gemmologiques telles qu&apos;enregistrées
            par {maison.legalName}. Il ne remplace pas le certificat original du laboratoire
            mentionné ci-dessus, disponible sur demande.
          </p>
        </footer>
      </article>

      <div className="flex flex-wrap justify-center gap-2 print:hidden">
        <PrintButton label="Imprimer le certificat" />
        <Link href={`/inventaire/${productId}`} className={`${buttonGhost} h-11 min-h-11`}>
          Retour à la fiche pièce
        </Link>
      </div>
    </div>
  );
}
