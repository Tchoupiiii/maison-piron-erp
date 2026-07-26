"use client";

import { buttonPrimary } from "@/components/ui";

/**
 * L'impression passe par le pilote du système : aucun flux ESC/POS, aucun
 * pilote embarqué dans l'ERP. Le format du ticket est décidé par la feuille de
 * style (@page), le reste est l'affaire de l'imprimante choisie dans le dialogue.
 */
export function PrintButton({ label = "Imprimer le ticket" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${buttonPrimary} h-11 min-h-11`}>
      {label}
    </button>
  );
}
