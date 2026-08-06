"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anonymizeStaleEnquiriesAction } from "@/actions/rgpd-web";
import { buttonGhost } from "@/components/ui";

const CONFIRM =
  "Anonymiser les demandes non traitées depuis plus de 12 mois, et traitées depuis plus de 24 mois ? Le nom, l'e-mail et le téléphone seront écrasés définitivement.";

export function AnonymizeStaleEnquiriesButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className={buttonGhost}
        onClick={() => {
          if (!window.confirm(CONFIRM)) return;
          setMessage(null);
          startTransition(async () => {
            const result = await anonymizeStaleEnquiriesAction();
            if (!result.ok) {
              setMessage(result.error);
              return;
            }
            setMessage(
              result.data.count > 0
                ? `${result.data.count} demande(s) anonymisée(s).`
                : "Aucune demande à anonymiser pour l'instant.",
            );
            router.refresh();
          });
        }}
      >
        {pending ? "Anonymisation…" : "Nettoyer les demandes anciennes (RGPD)"}
      </button>
      {message && <span className="max-w-xs text-caption text-mid-gray">{message}</span>}
    </span>
  );
}
