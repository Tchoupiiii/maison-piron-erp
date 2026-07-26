import { getStaffSession } from "@/actions/auth-guard";
import { PosRegister } from "@/components/pos-register";
import { Notice } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";

export default async function PosPage() {
  const session = await getStaffSession();
  if (!session) return null;

  if (!session.can(PERMISSIONS.ventesCreer)) {
    return (
      <Notice tone="warning">
        Votre compte n&apos;a pas le droit d&apos;encaisser une vente. Demandez la
        permission « Encaisser une vente » à un administrateur.
      </Notice>
    );
  }

  const [{ data: products }, { data: customers }, { data: terminals }] = await Promise.all([
    // `product_availability` et non `products` : une pièce déjà dans un autre
    // panier — autre caisse ou commande en ligne — doit apparaître indisponible.
    session.supabase
      .from("product_availability")
      .select("id, sku, name, cached_ttc, status, rfid_tag, is_available")
      .in("status", ["en_stock", "reserve"])
      .order("name"),
    session.supabase
      .from("customers")
      .select("id, full_name")
      .eq("is_anonymized", false)
      .order("full_name"),
    session.supabase
      .from("pos_terminals")
      .select("id, name, code")
      .eq("is_active", true)
      .order("code"),
  ]);

  // Une vue PostgREST rend toutes ses colonnes nullables ; la clause `in` sur
  // `status` garantit pourtant qu'on ne reçoit que des lignes complètes.
  const sellable = (products ?? [])
    .filter((p) => p.id && p.sku && p.name)
    .map((p) => ({
      id: p.id!,
      sku: p.sku!,
      name: p.name!,
      cached_ttc: p.cached_ttc,
      status: p.status!,
      rfid_tag: p.rfid_tag,
      is_available: p.is_available ?? false,
    }));

  return (
    <PosRegister
      products={sellable}
      customers={customers ?? []}
      terminals={terminals ?? []}
      canInvoice={session.can(PERMISSIONS.ventesFacturer)}
    />
  );
}
