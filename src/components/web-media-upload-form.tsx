"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadWebMedia } from "@/actions/web";
import { buttonGhost, selectClass } from "@/components/ui";

export const WEB_MEDIA_LABELS: Record<string, string> = {
  packshot: "Vue face",
  profil: "Vue profil",
  porte: "Porté",
  macro: "Macro pierre",
};

export function WebMediaUploadForm({ productId }: { productId: string }) {
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
          const result = await uploadWebMedia(productId, formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <select name="mediaType" defaultValue="packshot" className={`${selectClass} w-auto`}>
        {Object.entries(WEB_MEDIA_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input
        type="file"
        name="file"
        accept="image/jpeg,image/png,image/webp"
        required
        className="max-w-[200px] text-caption text-mid-gray file:mr-2 file:rounded-pill file:border file:border-hairline file:bg-transparent file:px-2 file:py-1 file:text-caption"
      />
      <button
        type="submit"
        disabled={pending}
        className={`${buttonGhost} h-9 min-h-9 px-3 text-caption`}
      >
        {pending ? "Envoi…" : "Ajouter la photo"}
      </button>
      {error && <span className="text-caption text-ember">{error}</span>}
    </form>
  );
}
