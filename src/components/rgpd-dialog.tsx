"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anonymizeCustomer } from "@/actions/rgpd";
import { buttonDanger, buttonGhost, inputClass } from "@/components/ui";
import { RGPD_CONFIRMATION_WORD } from "@/lib/constants";

/**
 * Dialogue en deux temps : l'écran d'avertissement, puis la saisie du mot.
 * Le mot est revalidé côté serveur — ce garde-fou est une aide, pas la sécurité.
 */
export function RgpdDialog({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const [step, setStep] = useState<0 | 1>(0);
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (step === 0) {
    return (
      <button type="button" className={buttonDanger} onClick={() => setStep(1)}>
        Anonymiser la fiche
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 rounded-card border border-ember/40 bg-paper p-5">
      <div className="flex flex-col gap-2">
        <span className="text-subheading font-medium">
          Droit à l&apos;effacement · article 17
        </span>
        <p className="text-body text-mid-gray">
          Les coordonnées de {customerName} seront écrasées définitivement. Les
          factures et réparations restent intactes : la loi comptable belge impose
          leur conservation pendant 7 ans (art. 60 CTVA). L&apos;opération est
          journalisée avec votre identifiant et son horodatage.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-caption uppercase tracking-[0.6px] text-mid-gray">
          Saisissez « {RGPD_CONFIRMATION_WORD} » pour confirmer
        </span>
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={RGPD_CONFIRMATION_WORD}
          className={inputClass}
          autoComplete="off"
        />
      </label>

      {error && <p className="text-caption text-ember">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || word.trim().toUpperCase() !== RGPD_CONFIRMATION_WORD}
          className={buttonDanger}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await anonymizeCustomer(customerId, word);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setStep(0);
              setWord("");
              router.refresh();
            });
          }}
        >
          {pending ? "Effacement…" : "Confirmer l'anonymisation"}
        </button>
        <button
          type="button"
          className={buttonGhost}
          onClick={() => {
            setStep(0);
            setWord("");
            setError(null);
          }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
