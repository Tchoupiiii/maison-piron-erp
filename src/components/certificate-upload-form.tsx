"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadGemstoneCertificate } from "@/actions/products";
import { buttonGhost } from "@/components/ui";

export function CertificateUploadForm({
  productId,
  gemstoneId,
}: {
  productId: string;
  gemstoneId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await uploadGemstoneCertificate(productId, gemstoneId, formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <input
        type="file"
        name="file"
        accept="application/pdf,image/jpeg,image/png"
        required
        className="max-w-[220px] text-caption text-mid-gray file:mr-2 file:rounded-pill file:border file:border-hairline file:bg-transparent file:px-2 file:py-1 file:text-caption"
      />
      <button type="submit" disabled={pending} className={`${buttonGhost} h-9 min-h-9 px-3 text-caption`}>
        {pending ? "Envoi…" : "Ajouter le scan"}
      </button>
      {error && <span className="text-caption text-ember">{error}</span>}
    </form>
  );
}
