import Link from "next/link";
import { getStaffSession } from "@/actions/auth-guard";
import { getMaison } from "@/lib/maison";
import { createProduct } from "@/actions/products";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Section,
  StatRow,
  buttonGhost,
  buttonPrimary,
  inputClass,
  labelClass,
  selectClass,
} from "@/components/ui";
import { formatEUR, PRODUCT_STATUS_LABELS } from "@/lib/constants";
import { PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "@/actions/types";
import type { Database } from "@/types/database.types";

type ProductStatus = Database["public"]["Enums"]["product_status"];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Tous les statuts" },
  { value: "en_stock", label: "En stock" },
  { value: "reserve", label: "Réservé" },
  { value: "vendu", label: "Vendu" },
];

export default async function InventairePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; statut?: string; nouveau?: string }>;
}) {
  const { q, statut, nouveau } = await searchParams;
  const [session, maison] = await Promise.all([getStaffSession(), getMaison()]);
  if (!session) return null;

  let query = session.supabase
    .from("products")
    .select(
      "id, sku, name, status, showcase_slot, cached_ttc, cached_ht, price_computed_at, product_materials(metal_kind, purity_per_mille, weight_grams)",
    )
    .order("sku");

  if (q) query = query.or(`sku.ilike.%${q}%,name.ilike.%${q}%`);
  if (statut) query = query.eq("status", statut as ProductStatus);

  const { data: products, error } = await query;
  const rows = products ?? [];

  const inStock = rows.filter((p) => p.status === "en_stock");
  const reserved = rows.filter((p) => p.status === "reserve");
  const stockValue = inStock.reduce((sum, p) => sum + (p.cached_ttc ?? 0), 0);

  async function submitProduct(formData: FormData): Promise<ActionResult<unknown>> {
    "use server";
    const weight = Number(formData.get("weightGrams"));
    return createProduct({
      sku: String(formData.get("sku") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      showcaseSlot: String(formData.get("showcaseSlot") ?? "") || null,
      laborCostEur: Number(formData.get("laborCostEur") ?? 0),
      laborDescription: String(formData.get("laborDescription") ?? "") || null,
      marginMultiplier: Number(formData.get("marginMultiplier") ?? 2),
      materials:
        weight > 0
          ? [
              {
                metalKind: String(formData.get("metalKind") ?? "or") as
                  | "or"
                  | "argent"
                  | "platine",
                purityPerMille: Number(formData.get("purityPerMille") ?? 750),
                weightGrams: weight,
              },
            ]
          : [],
      gemstones: [],
    });
  }

  const { data: titles } = await session.supabase
    .from("metal_titles")
    .select("metal_kind, purity_per_mille, label")
    .order("metal_kind")
    .order("sort");

  const canCreate = session.can(PERMISSIONS.inventaireCreer);
  const showForm = nouveau === "1" && canCreate;

  return (
    <>
      <PageHeader
        breadcrumb={[maison.displayName, "Boutique", "Inventaire"]}
        title="Inventaire"
        aside={
          canCreate ? (
            <Link
              href={showForm ? "/inventaire" : "/inventaire?nouveau=1"}
              className={showForm ? buttonGhost : buttonPrimary}
            >
              {showForm ? "Fermer" : "Nouvelle pièce"}
            </Link>
          ) : undefined
        }
      />

      <Section>
        <StatRow
          stats={[
            { label: "En stock", value: String(inStock.length), sub: "pièces en vitrine" },
            { label: "Réservées", value: String(reserved.length), sub: "en attente de retrait" },
            {
              label: "Valeur vitrine",
              value: formatEUR(stockValue),
              sub: "TTC au dernier calcul",
            },
            { label: "Catalogue", value: String(rows.length), sub: "toutes pièces" },
          ]}
        />

        {showForm && (
          <Card title="Nouvelle pièce" subtitle="Le prix se calcule dès qu'un métal est renseigné.">
            <ActionForm
              action={submitProduct}
              className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 p-5"
              successMessage="Pièce créée."
              resetOnSuccess
            >
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Référence</span>
                <input name="sku" required placeholder="MP-BAG-0500" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Nom</span>
                <input name="name" required placeholder="Solitaire Cointe" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Emplacement vitrine</span>
                <input name="showcaseSlot" placeholder="vitrine 2" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Métal</span>
                <select name="metalKind" className={selectClass} defaultValue="or">
                  <option value="or">Or</option>
                  <option value="argent">Argent</option>
                  <option value="platine">Platine</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Titre</span>
                <select name="purityPerMille" className={selectClass} defaultValue="750">
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
                  min="0"
                  placeholder="6.400"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Façon (€)</span>
                <input
                  name="laborCostEur"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue="0"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Détail de la façon</span>
                <input
                  name="laborDescription"
                  placeholder="14 h serti + polissage"
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
                  defaultValue="2.10"
                  className={inputClass}
                />
              </label>
              <label className="col-span-full flex flex-col gap-1">
                <span className={labelClass}>Description</span>
                <textarea name="description" rows={2} className={`${inputClass} h-auto py-2`} />
              </label>
              <div className="col-span-full">
                <button type="submit" className={buttonPrimary}>
                  Créer la pièce
                </button>
              </div>
            </ActionForm>
          </Card>
        )}

        <form className="flex flex-wrap items-end gap-3" action="/inventaire">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Rechercher</span>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Référence ou nom"
              className={`${inputClass} w-64`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Statut</span>
            <select name="statut" defaultValue={statut ?? ""} className={`${selectClass} w-48`}>
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonGhost}>
            Filtrer
          </button>
        </form>

        {error ? (
          <Card>
            <EmptyState title="Inventaire indisponible" hint={error.message} />
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Aucune pièce ne correspond"
              hint="Modifiez la recherche ou le filtre de statut."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
            {rows.map((product) => {
              const material = product.product_materials?.[0];
              return (
                <Link
                  key={product.id}
                  href={`/inventaire/${product.id}`}
                  className="flex flex-col gap-3"
                >
                  <div className="relative grid aspect-[4/5] place-items-center rounded-card border border-hairline bg-paper shadow-card">
                    <span className="tabular text-caption tracking-[0.6px] text-mid-gray">
                      {product.showcase_slot ?? product.sku}
                    </span>
                    <span className="absolute right-3 top-3">
                      <Badge tone={product.status === "vendu" ? "neutral" : "solid"}>
                        {PRODUCT_STATUS_LABELS[product.status]}
                      </Badge>
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-body font-medium">{product.name}</span>
                    <span className="tabular text-[13px] text-mid-gray">
                      {product.cached_ttc !== null
                        ? formatEUR(product.cached_ttc)
                        : "prix à calculer"}
                    </span>
                    {material && (
                      <span className="text-caption text-mid-gray">
                        {material.weight_grams} g · {material.metal_kind}{" "}
                        {material.purity_per_mille} ‰
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
