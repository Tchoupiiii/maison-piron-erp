import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import {
  addGemstone,
  deleteGemstoneCertificate,
  deleteProduct,
  removeGemstone,
  replaceProductMaterials,
  setProductStatus,
  updateGemstone,
  updateProduct,
} from "@/actions/products";
import { recalculateProductPrice, setProductPricingInputs } from "@/actions/pricing";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { CertificateUploadForm } from "@/components/certificate-upload-form";
import { PriceSimulator } from "@/components/price-simulator";
import { AccessRestricted } from "@/components/access-restricted";
import {
  Badge,
  Card,
  Notice,
  PageHeader,
  Section,
  StatRow,
  buttonDanger,
  buttonGhost,
  buttonPrimary,
  inputClass,
  labelClass,
  selectClass,
} from "@/components/ui";
import {
  CERTIFICATE_LAB_LABELS,
  formatEUR,
  GEMSTONE_TYPE_LABELS,
  PRODUCT_STATUS_LABELS,
} from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type MetalKind = Database["public"]["Enums"]["metal_kind"];

type GemstoneInput = Parameters<typeof addGemstone>[1];

function gemstoneInputFromForm(formData: FormData): GemstoneInput {
  return {
    name: String(formData.get("name") ?? ""),
    gemstoneType: String(
      formData.get("gemstoneType") ?? "autre",
    ) as GemstoneInput["gemstoneType"],
    caratWeight: Number(formData.get("caratWeight") ?? 0),
    stoneCount: Number(formData.get("stoneCount") ?? 1),
    pricePerCarat: Number(formData.get("pricePerCarat") ?? 0),
    clarity: String(formData.get("clarity") ?? "") || null,
    color: String(formData.get("color") ?? "") || null,
    cut: String(formData.get("cut") ?? "") || null,
    certificateLab: String(
      formData.get("certificateLab") ?? "aucun",
    ) as GemstoneInput["certificateLab"],
    certificateNumber: String(formData.get("certificateNumber") ?? "") || null,
  };
}

/** Champs communs aux formulaires « Ajouter » et « Modifier » une pierre. */
function GemstoneFields({
  defaults,
}: {
  defaults?: {
    name: string;
    gemstone_type: string;
    carat_weight: number;
    stone_count: number;
    price_per_carat: number;
    clarity: string | null;
    color: string | null;
    cut: string | null;
    certificate_lab: string;
    certificate_number: string | null;
  };
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Nom de la pierre</span>
        <input
          name="name"
          required
          defaultValue={defaults?.name ?? ""}
          placeholder="Saphir de Ceylan"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Type</span>
        <select
          name="gemstoneType"
          defaultValue={defaults?.gemstone_type ?? "diamant"}
          className={selectClass}
        >
          {Object.entries(GEMSTONE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Poids (ct)</span>
        <input
          name="caratWeight"
          type="number"
          min="0.001"
          step="0.001"
          required
          defaultValue={defaults?.carat_weight ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Nombre</span>
        <input
          name="stoneCount"
          type="number"
          min="1"
          step="1"
          defaultValue={defaults?.stone_count ?? 1}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Prix au carat (€)</span>
        <input
          name="pricePerCarat"
          type="number"
          min="0"
          step="0.01"
          defaultValue={defaults?.price_per_carat ?? 0}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Pureté</span>
        <input
          name="clarity"
          defaultValue={defaults?.clarity ?? ""}
          placeholder="VS1"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Couleur</span>
        <input
          name="color"
          defaultValue={defaults?.color ?? ""}
          placeholder="F"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Taille</span>
        <input
          name="cut"
          defaultValue={defaults?.cut ?? ""}
          placeholder="Brillant"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Laboratoire</span>
        <select
          name="certificateLab"
          defaultValue={defaults?.certificate_lab ?? "aucun"}
          className={selectClass}
        >
          {Object.entries(CERTIFICATE_LAB_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>N° de certificat</span>
        <input
          name="certificateNumber"
          defaultValue={defaults?.certificate_number ?? ""}
          className={inputClass}
        />
      </label>
    </>
  );
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;
  if (!session.can(PERMISSIONS.inventaireVoir)) {
    return (
      <AccessRestricted
        breadcrumb={[maison.displayName, "Boutique", "Inventaire"]}
        title="Fiche pièce"
        permissionLabel="Consulter l'inventaire"
      />
    );
  }

  const { data: product } = await session.supabase
    .from("products")
    .select(
      "id, sku, name, description, status, showcase_slot, rfid_tag, labor_cost_eur, labor_description, margin_multiplier, cached_metal_cost, cached_stone_cost, cached_ht, cached_ttc, price_computed_at, sold_at, product_materials(id, metal_kind, purity_per_mille, color, weight_grams, detail), product_gemstones(id, name, gemstone_type, carat_weight, stone_count, price_per_carat, clarity, color, cut, certificate_lab, certificate_number, product_media(id, storage_path, created_at))",
    )
    .eq("id", productId)
    .maybeSingle();

  if (!product) notFound();

  const certificateUrls = new Map<string, string>();
  for (const g of product.product_gemstones ?? []) {
    for (const media of g.product_media ?? []) {
      const { data: signed } = await session.supabase.storage
        .from("produit_media")
        .createSignedUrl(media.storage_path, 300);
      if (signed) certificateUrls.set(media.id, signed.signedUrl);
    }
  }

  const [{ data: titles }, { data: rateRows }, { data: history }] = await Promise.all([
    session.supabase
      .from("metal_titles")
      .select("metal_kind, purity_per_mille, label")
      .order("metal_kind")
      .order("sort"),
    session.supabase
      .from("market_rates")
      .select("metal_kind, price_eur_per_gram_fine, rate_date")
      .order("rate_date", { ascending: false })
      .limit(30),
    session.supabase
      .from("price_history")
      .select("computed_at, metal_cost, stone_cost, labor_cost, margin_multiplier, ht, ttc, reason")
      .eq("product_id", productId)
      .order("computed_at", { ascending: false })
      .limit(10),
  ]);

  // dernier cours connu par métal
  const rates: Partial<Record<MetalKind, number>> = {};
  for (const row of rateRows ?? []) {
    rates[row.metal_kind] ??= row.price_eur_per_gram_fine;
  }

  const material = product.product_materials?.[0];
  const stoneCost = (product.product_gemstones ?? []).reduce(
    (sum, g) => sum + g.carat_weight * g.stone_count * g.price_per_carat,
    0,
  );

  const canEdit = session.can(PERMISSIONS.inventaireModifier);
  const canPrice = session.can(PERMISSIONS.inventairePrix);
  const canStatus = session.can(PERMISSIONS.inventaireStatut);
  const canDelete = session.can(PERMISSIONS.inventaireSupprimer);
  const isSold = product.status === "vendu";

  async function saveIdentity(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return updateProduct(productId, {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      showcaseSlot: String(formData.get("showcaseSlot") ?? "") || null,
      rfidTag: String(formData.get("rfidTag") ?? "") || null,
    });
  }

  async function saveMaterial(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return replaceProductMaterials(productId, [
      {
        metalKind: String(formData.get("metalKind") ?? "or") as MetalKind,
        purityPerMille: Number(formData.get("purityPerMille") ?? 750),
        weightGrams: Number(formData.get("weightGrams") ?? 0),
        color: (String(formData.get("color") ?? "") || null) as
          | "jaune"
          | "blanc"
          | "rose"
          | null,
        detail: String(formData.get("detail") ?? "") || null,
      },
    ]);
  }

  async function savePricing(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return setProductPricingInputs(productId, {
      laborCostEur: Number(formData.get("laborCostEur") ?? 0),
      marginMultiplier: Number(formData.get("marginMultiplier") ?? 2),
      laborDescription: String(formData.get("laborDescription") ?? "") || undefined,
    });
  }

  async function submitNewGemstone(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    return addGemstone(productId, gemstoneInputFromForm(formData));
  }

  async function saveGemstone(
    gemstoneId: string,
    formData: FormData,
  ): Promise<ActionResult<unknown>> {
    "use server";
    return updateGemstone(productId, gemstoneId, gemstoneInputFromForm(formData));
  }

  const gemstoneSuccessMessage = canPrice
    ? "Pierre enregistrée, prix recalculé."
    : "Pierre enregistrée. Recalculez le prix pour la répercuter.";

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Inventaire", product.sku]}
        title={product.name}
        aside={
          <>
            <Badge tone={isSold ? "neutral" : "solid"}>
              {PRODUCT_STATUS_LABELS[product.status]}
            </Badge>
            <Link href="/inventaire" className={buttonGhost}>
              Retour
            </Link>
          </>
        }
      />

      <Section>
        <StatRow
          stats={[
            { label: "Prix TTC", value: product.cached_ttc ? formatEUR(product.cached_ttc) : "—", sub: "affiché en vitrine" },
            { label: "Prix HT", value: product.cached_ht ? formatEUR(product.cached_ht) : "—" },
            { label: "Coût métal", value: product.cached_metal_cost ? formatEUR(product.cached_metal_cost) : "—" },
            { label: "Coût pierres", value: formatEUR(stoneCost) },
          ]}
        />

        {isSold && (
          <Notice>
            Pièce vendue le {product.sold_at?.slice(0, 10)} : le prix est figé et le
            statut ne peut plus changer, conservation comptable oblige.
          </Notice>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-6">
          <div className="flex flex-col gap-6">
            <Card title="Identité" subtitle={`Référence ${product.sku}`}>
              {canEdit && !isSold ? (
                <ActionForm
                  action={saveIdentity}
                  className="flex flex-col gap-4 p-5"
                  successMessage="Fiche enregistrée."
                >
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Nom</span>
                    <input name="name" defaultValue={product.name} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Emplacement vitrine</span>
                    <input
                      name="showcaseSlot"
                      defaultValue={product.showcase_slot ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Puce RFID (EPC)</span>
                    <input
                      name="rfidTag"
                      defaultValue={product.rfid_tag ?? ""}
                      placeholder="laisser vide si la pièce n'a qu'un code-barres"
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Description</span>
                    <textarea
                      name="description"
                      rows={4}
                      defaultValue={product.description ?? ""}
                      className={`${inputClass} h-auto py-2`}
                    />
                  </label>
                  <button type="submit" className={buttonPrimary}>
                    Enregistrer
                  </button>
                </ActionForm>
              ) : (
                <div className="flex flex-col gap-2 p-5">
                  <span className="text-body">{product.showcase_slot ?? "Hors vitrine"}</span>
                  <span className="tabular text-caption text-mid-gray">
                    {product.rfid_tag ? `RFID ${product.rfid_tag}` : "Sans puce RFID"}
                  </span>
                  <p className="text-body text-mid-gray">{product.description ?? "—"}</p>
                  {!canEdit && (
                    <p className="text-caption text-mid-gray">
                      Lecture seule : droit « Modifier une pièce » non accordé.
                    </p>
                  )}
                </div>
              )}
            </Card>

            <Card title="Composition métal">
              {canEdit && !isSold ? (
                <ActionForm
                  action={saveMaterial}
                  className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 p-5"
                  successMessage="Composition enregistrée. Recalculez le prix pour la répercuter."
                >
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Métal</span>
                    <select
                      name="metalKind"
                      defaultValue={material?.metal_kind ?? "or"}
                      className={selectClass}
                    >
                      <option value="or">Or</option>
                      <option value="argent">Argent</option>
                      <option value="platine">Platine</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Titre / carat</span>
                    <select
                      name="purityPerMille"
                      defaultValue={material?.purity_per_mille ?? 750}
                      className={selectClass}
                    >
                      {(titles ?? []).map((t) => (
                        <option
                          key={`${t.metal_kind}-${t.purity_per_mille}`}
                          value={t.purity_per_mille}
                        >
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Poids (g)</span>
                    <input
                      name="weightGrams"
                      type="number"
                      step="0.001"
                      min="0.001"
                      defaultValue={material?.weight_grams ?? ""}
                      required
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Couleur</span>
                    <select
                      name="color"
                      defaultValue={material?.color ?? ""}
                      className={selectClass}
                    >
                      <option value="">—</option>
                      <option value="jaune">Jaune</option>
                      <option value="blanc">Blanc</option>
                      <option value="rose">Rose</option>
                    </select>
                  </label>
                  <label className="col-span-full flex flex-col gap-1">
                    <span className={labelClass}>Détail</span>
                    <input
                      name="detail"
                      defaultValue={material?.detail ?? ""}
                      placeholder="750 ‰ · rhodié"
                      className={inputClass}
                    />
                  </label>
                  <div className="col-span-full">
                    <button type="submit" className={buttonPrimary}>
                      Enregistrer la composition
                    </button>
                  </div>
                </ActionForm>
              ) : (
                <div className="flex flex-col gap-1 p-5 text-body">
                  {material ? (
                    <>
                      <span>
                        {material.weight_grams} g · {material.metal_kind}{" "}
                        {material.purity_per_mille} ‰
                      </span>
                      <span className="text-mid-gray">{material.detail ?? ""}</span>
                    </>
                  ) : (
                    <span className="text-mid-gray">Aucun métal renseigné</span>
                  )}
                </div>
              )}
            </Card>

            <Card title="Pierres" subtitle="Elles entrent dans le prix calculé.">
              {(product.product_gemstones ?? []).length === 0 && (
                <p className="p-5 text-body text-mid-gray">Aucune pierre.</p>
              )}
              {(product.product_gemstones ?? []).length > 0 && (
                <div className="flex flex-col">
                  {product.product_gemstones.map((g) => (
                    <div
                      key={g.id}
                      className="flex flex-col gap-3 border-b border-canvas px-5 py-3 last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex flex-col">
                          <span className="text-body font-medium">{g.name}</span>
                          <span className="text-caption text-mid-gray">
                            {g.stone_count} × {g.carat_weight} ct · {g.clarity ?? "—"} ·{" "}
                            {g.certificate_lab}
                            {g.certificate_number ? ` ${g.certificate_number}` : ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="tabular text-body">
                            {formatEUR(g.carat_weight * g.stone_count * g.price_per_carat)}
                          </span>
                          <Link
                            href={`/inventaire/${productId}/certificat/${g.id}`}
                            className={`${buttonGhost} h-9 min-h-9 px-3 text-caption`}
                          >
                            Certificat imprimable
                          </Link>
                          {canEdit && !isSold && (
                            <ActionButton
                              action={removeGemstone.bind(null, productId, g.id)}
                              className={`${buttonGhost} h-9 min-h-9 px-3 text-caption`}
                              confirm={`Retirer ${g.name} ? Ses certificats scannés seront supprimés.`}
                            >
                              Retirer
                            </ActionButton>
                          )}
                        </div>
                      </div>

                      {canEdit && !isSold && (
                        <details className="rounded-card border border-hairline bg-surface-alt">
                          <summary className="cursor-pointer px-3 py-2 text-caption text-mid-gray">
                            Modifier la pierre
                          </summary>
                          <ActionForm
                            action={saveGemstone.bind(null, g.id)}
                            className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 p-3"
                            successMessage={gemstoneSuccessMessage}
                          >
                            <GemstoneFields defaults={g} />
                            <div className="col-span-full">
                              <button type="submit" className={buttonPrimary}>
                                Enregistrer la pierre
                              </button>
                            </div>
                          </ActionForm>
                        </details>
                      )}

                      <div className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-alt p-3">
                        <span className={labelClass}>Certificat scanné (labo)</span>
                        {(g.product_media ?? []).length === 0 ? (
                          <span className="text-caption text-mid-gray">Aucun fichier attaché.</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {g.product_media!.map((media) => (
                              <li key={media.id} className="flex items-center justify-between gap-3">
                                <a
                                  href={certificateUrls.get(media.id) ?? "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-caption text-ink underline underline-offset-2"
                                >
                                  Ouvrir le scan du {media.created_at.slice(0, 10)}
                                </a>
                                {canDelete && (
                                  <ActionButton
                                    action={deleteGemstoneCertificate.bind(null, media.id)}
                                    className={`${buttonGhost} h-8 min-h-8 px-2 text-caption`}
                                    confirm="Retirer ce fichier de certificat ?"
                                  >
                                    Retirer
                                  </ActionButton>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {canEdit && (
                          <CertificateUploadForm productId={productId} gemstoneId={g.id} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canEdit && !isSold && (
                <details className="border-t border-canvas">
                  <summary className="cursor-pointer px-5 py-3 text-body text-mid-gray">
                    Ajouter une pierre
                  </summary>
                  <ActionForm
                    action={submitNewGemstone}
                    className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 px-5 pb-5"
                    successMessage={gemstoneSuccessMessage}
                    resetOnSuccess
                  >
                    <GemstoneFields />
                    <div className="col-span-full">
                      <button type="submit" className={buttonPrimary}>
                        Ajouter la pierre
                      </button>
                    </div>
                  </ActionForm>
                </details>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card
              title="Simulateur de prix"
              subtitle="Aperçu local : rien n'est enregistré tant que vous ne recalculez pas."
            >
              <PriceSimulator
                titles={titles ?? []}
                rates={rates}
                initial={{
                  metalKind: material?.metal_kind ?? "or",
                  purityPerMille: material?.purity_per_mille ?? 750,
                  weightGrams: material?.weight_grams ?? 0,
                  laborCostEur: product.labor_cost_eur,
                  marginMultiplier: product.margin_multiplier,
                }}
                initialGemstones={(product.product_gemstones ?? []).map((g) => ({
                  id: g.id,
                  name: g.name,
                  caratWeight: g.carat_weight,
                  stoneCount: g.stone_count,
                  pricePerCarat: g.price_per_carat,
                }))}
              />
            </Card>

            <Card title="Façon et marge">
              {canPrice && !isSold ? (
                <ActionForm
                  action={savePricing}
                  className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 p-5"
                  successMessage="Prix recalculé et enregistré."
                >
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Façon (€)</span>
                    <input
                      name="laborCostEur"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={product.labor_cost_eur}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Coefficient</span>
                    <input
                      name="marginMultiplier"
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={product.margin_multiplier}
                      className={inputClass}
                    />
                  </label>
                  <label className="col-span-full flex flex-col gap-1">
                    <span className={labelClass}>Détail de la façon</span>
                    <input
                      name="laborDescription"
                      defaultValue={product.labor_description ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <div className="col-span-full flex flex-wrap gap-2">
                    <button type="submit" className={buttonPrimary}>
                      Enregistrer et recalculer
                    </button>
                  </div>
                </ActionForm>
              ) : (
                <div className="flex flex-col gap-1 p-5 text-body">
                  <span>
                    Façon {formatEUR(product.labor_cost_eur)} · coefficient ×
                    {product.margin_multiplier}
                  </span>
                  <span className="text-mid-gray">{product.labor_description ?? ""}</span>
                  {!canPrice && (
                    <p className="text-caption text-mid-gray">
                      Lecture seule : droit « Modifier les prix » non accordé.
                    </p>
                  )}
                </div>
              )}
            </Card>

            <Card
              title="Actions"
              subtitle={
                product.price_computed_at
                  ? `Dernier calcul le ${product.price_computed_at.slice(0, 10)}`
                  : "Jamais calculé"
              }
            >
              <div className="flex flex-wrap gap-3 p-5">
                {canPrice && !isSold && (
                  <ActionButton
                    action={recalculateProductPrice.bind(null, productId)}
                    className={buttonGhost}
                  >
                    Recalculer l&apos;étiquette
                  </ActionButton>
                )}
                {canStatus && !isSold && product.status !== "reserve" && (
                  <ActionButton
                    action={setProductStatus.bind(null, productId, "reserve")}
                    className={buttonGhost}
                  >
                    Marquer réservée
                  </ActionButton>
                )}
                {canStatus && !isSold && product.status !== "en_stock" && (
                  <ActionButton
                    action={setProductStatus.bind(null, productId, "en_stock")}
                    className={buttonGhost}
                  >
                    Remettre en stock
                  </ActionButton>
                )}
                {canDelete && (
                  <ActionButton
                    action={deleteProduct.bind(null, productId)}
                    className={buttonDanger}
                    confirm={`Supprimer définitivement ${product.sku} ? Cette action est irréversible.`}
                  >
                    Supprimer
                  </ActionButton>
                )}
              </div>
            </Card>

            <Card title="Historique des prix">
              {(history ?? []).length === 0 ? (
                <p className="p-5 text-body text-mid-gray">Aucun calcul enregistré.</p>
              ) : (
                <div className="flex flex-col">
                  {history!.map((h) => (
                    <div
                      key={h.computed_at}
                      className="grid grid-cols-[120px_1fr_auto] items-center gap-4 border-b border-canvas px-5 py-3 last:border-b-0"
                    >
                      <span className="tabular text-[13px] text-mid-gray">
                        {h.computed_at.slice(0, 10)}
                      </span>
                      <span className="text-[13px] text-mid-gray">
                        {h.reason === "sync_cours"
                          ? "Variation des cours"
                          : h.reason === "creation"
                            ? "Création"
                            : "Édition manuelle"}
                      </span>
                      <span className="tabular text-body">{formatEUR(h.ttc)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
