"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSale } from "@/actions/transactions";
import { releaseHold, scanProduct } from "@/actions/pos";
import { formatEUR, PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { buttonGhost, buttonPrimary, inputClass, labelClass, selectClass } from "@/components/ui";
import type { Database } from "@/types/database.types";

type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export type SellableProduct = {
  id: string;
  sku: string;
  name: string;
  cached_ttc: number | null;
  status: Database["public"]["Enums"]["product_status"];
  rfid_tag?: string | null;
  is_available?: boolean;
};

type CartLine = {
  product: SellableProduct;
  quantity: number;
  /** Prix arrêté par la base au moment de la réservation. */
  priceTtc: number;
  holdExpiresAt: string;
};

export function PosRegister({
  products,
  customers,
  terminals,
  canInvoice,
}: {
  products: SellableProduct[];
  customers: { id: string; full_name: string | null }[];
  terminals: { id: string; name: string; code: string }[];
  canInvoice: boolean;
}) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [terminalId, setTerminalId] = useState(terminals[0]?.id ?? "");
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bancontact");
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /**
   * Identifiant du panier, tiré au sort à l'ouverture de la caisse. C'est lui
   * que la base retient pour savoir qui tient quelle pièce : deux onglets, deux
   * caisses ou le site web ne peuvent pas se marcher dessus.
   */
  const [cartRef] = useState(
    () => `POS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
  );

  // Quitter la page ne doit pas immobiliser les pièces : on rend la main.
  useEffect(() => {
    return () => {
      void releaseHold(cartRef, null, "caisse fermée");
    };
  }, [cartRef]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(needle) ||
        p.name.toLowerCase().includes(needle) ||
        (p.rfid_tag ?? "").toLowerCase().includes(needle),
    );
  }, [products, search]);

  const subtotal = cart.reduce((sum, line) => sum + line.priceTtc * line.quantity, 0);
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  /**
   * Scanner, c'est réserver — pas vendre. La base pose une réservation de
   * 30 minutes et refuse si la pièce est déjà dans un autre panier, en boutique
   * comme sur le site. Le stock, lui, ne bougera qu'au paiement.
   */
  function scan(code: string) {
    if (!code.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await scanProduct(code, cartRef, terminalId || null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const line = result.data;
      setCart((current) =>
        current.some((l) => l.product.id === line.productId)
          ? current
          : [
              ...current,
              {
                product: {
                  id: line.productId,
                  sku: line.sku,
                  name: line.name,
                  cached_ttc: line.priceTtc,
                  status: "en_stock",
                },
                quantity: 1,
                priceTtc: line.priceTtc,
                holdExpiresAt: line.holdExpiresAt,
              },
            ],
      );
      setSearch("");
      searchRef.current?.focus();
    });
  }

  /** Retirer une pièce du panier la rouvre immédiatement à la vente. */
  function removeLine(productId: string) {
    setCart((current) => current.filter((l) => l.product.id !== productId));
    void releaseHold(cartRef, productId, "retirée du panier");
  }

  function clearCart() {
    setCart([]);
    setDiscount(0);
    setError(null);
    void releaseHold(cartRef, null, "panier vidé");
  }

  function handleScan(event: React.FormEvent) {
    event.preventDefault();
    scan(search);
  }

  function checkout() {
    if (cart.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await createSale({
        customerId: customerId || null,
        terminalId: terminalId || null,
        paymentMethod,
        discount,
        markPaid: true,
        emitInvoice: wantsInvoice && Boolean(customerId),
        cartRef,
        items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCart([]);
      router.push(`/pos/ticket/${result.data.transactionId}`);
    });
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 max-lg:grid-cols-1">
      <div className="flex flex-col gap-4">
        <form onSubmit={handleScan} className="flex gap-2">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Scanner un code-barres, une puce RFID, ou saisir une référence…"
            autoFocus
            className={`${inputClass} h-12 flex-1 text-body-lg`}
            aria-label="Recherche ou scan"
          />
          <button type="submit" className={`${buttonPrimary} h-12 min-h-12 px-6`}>
            Ajouter
          </button>
        </form>

        {filtered.length === 0 ? (
          <p className="rounded-card border border-hairline bg-paper p-5 text-body text-mid-gray">
            Aucune pièce ne correspond à « {search} ».
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {filtered.map((product) => (
              <button
                key={product.id}
                type="button"
                disabled={product.is_available === false || pending}
                onClick={() => scan(product.sku)}
                className="flex min-h-[132px] flex-col items-start justify-between gap-3 rounded-card border border-hairline bg-paper p-4 text-left shadow-card transition-colors hover:bg-surface-alt disabled:opacity-45"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-body font-medium">{product.name}</span>
                  <span className="tabular text-caption text-mid-gray">
                    {product.sku}
                    {product.rfid_tag && " · RFID"}
                  </span>
                  {product.is_available === false && (
                    <span className="text-caption text-ember">
                      Réservée par un autre panier
                    </span>
                  )}
                </div>
                <span className="tabular text-subheading font-medium">
                  {product.cached_ttc !== null ? formatEUR(product.cached_ttc) : "prix à calculer"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="flex h-fit flex-col gap-4 rounded-card border border-hairline bg-paper p-5 shadow-card">
        <span className="text-subheading font-medium">Panier</span>

        {cart.length === 0 ? (
          <p className="text-body text-mid-gray">
            Scannez une pièce ou touchez une vignette pour commencer.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {cart.map((line) => (
              <div
                key={line.product.id}
                className="flex items-center justify-between gap-3 border-b border-canvas pb-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body">{line.product.name}</span>
                  <span className="tabular text-caption text-mid-gray">{line.product.sku}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-body">{formatEUR(line.priceTtc)}</span>
                  <button
                    type="button"
                    aria-label={`Retirer ${line.product.name}`}
                    onClick={() => removeLine(line.product.id)}
                    className="grid size-11 min-h-11 place-items-center rounded-pill border border-hairline text-mid-gray hover:text-ember"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Client</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={`${selectClass} h-11`}
          >
            <option value="">Client de passage</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>

        {terminals.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Caisse</span>
            <select
              value={terminalId}
              onChange={(e) => setTerminalId(e.target.value)}
              className={`${selectClass} h-11`}
            >
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Remise (€)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            max={subtotal}
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value) || 0)}
            className={`${inputClass} h-11`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Règlement</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className={`${selectClass} h-11`}
          >
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {canInvoice && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wantsInvoice}
              disabled={!customerId}
              onChange={(e) => setWantsInvoice(e.target.checked)}
              className="size-4 accent-ink"
            />
            <span className="text-body">
              Facture nominative
              {!customerId && (
                <span className="text-mid-gray"> · exige un client identifié</span>
              )}
            </span>
          </label>
        )}

        <dl className="flex flex-col gap-1 border-t border-hairline pt-3">
          <div className="flex justify-between text-body">
            <dt className="text-mid-gray">Sous-total</dt>
            <dd className="tabular">{formatEUR(subtotal)}</dd>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-body">
              <dt className="text-mid-gray">Remise</dt>
              <dd className="tabular">− {formatEUR(discount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-heading-sm font-medium">
            <dt>À payer</dt>
            <dd className="tabular">{formatEUR(total)}</dd>
          </div>
        </dl>

        {error && <p className="text-caption text-ember">{error}</p>}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={checkout}
            disabled={pending || cart.length === 0}
            className={`${buttonPrimary} h-12 min-h-12 text-body-lg`}
          >
            {pending ? "Encaissement…" : `Encaisser ${formatEUR(total)}`}
          </button>
          {cart.length > 0 && (
            <button type="button" onClick={clearCart} className={`${buttonGhost} h-11 min-h-11`}>
              Vider le panier
            </button>
          )}
        </div>

        <p className="text-caption text-mid-gray">
          Une pièce scannée est <strong>réservée</strong>, pas vendue : le stock ne
          bouge qu&apos;au paiement. Panier abandonné, la pièce se rouvre d&apos;elle-même
          après 30 minutes, en boutique comme en ligne. Les prix sont arrêtés par la
          base, jamais par cet écran.
        </p>
      </aside>
    </div>
  );
}
