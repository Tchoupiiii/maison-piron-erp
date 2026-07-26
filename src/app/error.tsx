"use client";

import { useEffect } from "react";
import { buttonGhost, buttonPrimary } from "@/components/ui";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-card border border-hairline bg-paper p-8 shadow-card">
        <div className="flex flex-col gap-2">
          <span className="tabular text-caption uppercase tracking-[0.6px] text-mid-gray">
            Incident
          </span>
          <h1 className="text-heading font-semibold">Cet écran n&apos;a pas pu s&apos;afficher</h1>
          <p className="text-body text-mid-gray">
            Aucune donnée n&apos;a été modifiée. Réessayez ; si l&apos;écran reste
            en erreur, notez la référence ci-dessous.
          </p>
          {error.digest && (
            <p className="tabular text-caption text-mid-gray">
              Référence technique : {error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reset} className={buttonPrimary}>
            Réessayer
          </button>
          <a href="/dashboard" className={buttonGhost}>
            Tableau de bord
          </a>
        </div>
      </div>
    </main>
  );
}
