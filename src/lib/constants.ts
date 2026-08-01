/** Mentions reprises telles quelles sur les factures (voir maquette, écran Ventes). */
export const MAISON = {
  legalName: "Maison Piron SRL",
  street: "Rue des Dominicains 3",
  postalCode: "4000",
  city: "Liège",
  country: "Belgique",
  vatNumber: "BE 0419.392.663",
} as const;

export const VAT_RATE = 0.21;

/** Délai de paiement par défaut sur facture. */
export const INVOICE_DUE_DAYS = 14;

export const INVOICE_LEGAL_NOTICE =
  "TVA 21 % — art. 5 AR n°1. Facture conservée 7 ans (art. 60 CTVA). " +
  "Réserve de propriété jusqu'au paiement intégral. Intérêts de retard 8 % l'an.";

/** Saisie exigée pour valider une anonymisation RGPD (étape 2 du dialogue). */
export const RGPD_CONFIRMATION_WORD = "ANONYMISER";

export const ANONYMIZED_NAME = "Client anonymisé";

export const REPAIR_COLUMNS = [
  { key: "check_in", label: "Réception" },
  { key: "at_bench", label: "À l'atelier" },
  { key: "ready", label: "Prêt · à retirer" },
  { key: "delivered", label: "Livré" },
] as const;

export const PRODUCT_STATUS_LABELS = {
  en_stock: "En stock",
  reserve: "Réservé",
  vendu: "Vendu",
} as const;

export const TRANSACTION_STATUS_LABELS = {
  brouillon: "Brouillon",
  emise: "Émise",
  payee_partielle: "Payée en partie",
  payee: "Payée",
  annulee: "Annulée",
} as const;

export const PAYMENT_METHOD_LABELS = {
  especes: "Espèces",
  bancontact: "Bancontact",
  carte: "Carte",
  virement: "Virement",
  mixte: "Paiement mixte",
} as const;

export const GEMSTONE_TYPE_LABELS = {
  diamant: "Diamant",
  emeraude: "Émeraude",
  saphir: "Saphir",
  rubis: "Rubis",
  perle: "Perle",
  autre: "Pierre",
} as const;

export const CERTIFICATE_LAB_LABELS = {
  GIA: "GIA — Gemological Institute of America",
  IGI: "IGI — International Gemological Institute",
  HRD: "HRD Antwerp",
  autre: "Laboratoire indépendant",
  aucun: "Non certifiée en laboratoire externe",
} as const;

export const METAL_LABELS = {
  or: "Or",
  argent: "Argent",
  platine: "Platine",
} as const;

/** 1 once troy = 31,1035 g — les cours sont publiés à l'once. */
export const TROY_OUNCE_GRAMS = 31.1035;

export function formatEUR(amount: number): string {
  return new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}
