"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/actions/types";

/**
 * Formulaire adossé à une Server Action typée : affiche l'erreur renvoyée
 * plutôt que de laisser l'échec silencieux, et rafraîchit la page au succès.
 */
export function ActionForm({
  action,
  children,
  className = "",
  successMessage,
  resetOnSuccess = false,
}: {
  action: (formData: FormData) => Promise<ActionResult<unknown>>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        setError(null);
        setDone(false);
        startTransition(async () => {
          const result = await action(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setDone(true);
          if (resetOnSuccess) form.reset();
          router.refresh();
        });
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {error && <p className="text-caption text-ember">{error}</p>}
      {done && successMessage && (
        <p className="text-caption text-mid-gray">{successMessage}</p>
      )}
    </form>
  );
}
