"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/actions/types";

type Props = {
  action: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  className: string;
  /** Texte de confirmation avant exécution, pour les gestes irréversibles. */
  confirm?: string;
  pendingLabel?: string;
  onDone?: string;
};

export function ActionButton({
  action,
  children,
  className,
  confirm,
  pendingLabel = "…",
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={className}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          startTransition(async () => {
            const result = await action();
            if (!result.ok) setError(result.error);
            else router.refresh();
          });
        }}
      >
        {pending ? pendingLabel : children}
      </button>
      {error && <span className="max-w-xs text-caption text-ember">{error}</span>}
    </span>
  );
}
