import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { MAISON } from "@/lib/constants";

export type Maison = {
  displayName: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  vatNumber: string;
};

/* La page de connexion n'a pas de session : la RLS lui cache maison_settings.
   Les valeurs historiques de constants.ts restent le filet de sécurité. */
const FALLBACK: Maison = { displayName: "Maison Piron", ...MAISON };

/** Identité de la boutique, éditable dans Réglages → Maison. Un fetch par requête. */
export const getMaison = cache(async (): Promise<Maison> => {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("maison_settings")
      .select("display_name, legal_name, street, postal_code, city, country, vat_number")
      .maybeSingle();

    if (!data) return FALLBACK;

    return {
      displayName: data.display_name,
      legalName: data.legal_name,
      street: data.street,
      postalCode: data.postal_code,
      city: data.city,
      country: data.country,
      vatNumber: data.vat_number,
    };
  } catch {
    return FALLBACK;
  }
});
