"use client";

import { useEffect, useRef, useState } from "react";
import { CERTIFICATE_LAB_LABELS, GEMSTONE_TYPE_LABELS } from "@/lib/constants";
import { buttonGhost, inputClass, labelClass, selectClass } from "@/components/ui";

type GemstoneType = keyof typeof GEMSTONE_TYPE_LABELS;
type CertificateLab = keyof typeof CERTIFICATE_LAB_LABELS;

/** Champs numériques en chaînes pendant la saisie, convertis à la sérialisation. */
type GemstoneDraft = {
  name: string;
  gemstoneType: GemstoneType;
  caratWeight: string;
  stoneCount: string;
  pricePerCarat: string;
  clarity: string;
  color: string;
  cut: string;
  certificateLab: CertificateLab;
  certificateNumber: string;
};

const EMPTY_DRAFT: GemstoneDraft = {
  name: "",
  gemstoneType: "diamant",
  caratWeight: "",
  stoneCount: "1",
  pricePerCarat: "0",
  clarity: "",
  color: "",
  cut: "",
  certificateLab: "aucun",
  certificateNumber: "",
};

/** Lignes valides (nom renseigné) au format attendu par `gemstoneSchema`. */
function serialize(rows: GemstoneDraft[]): string {
  return JSON.stringify(
    rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => ({
        name: r.name,
        gemstoneType: r.gemstoneType,
        caratWeight: Number(r.caratWeight),
        stoneCount: Number(r.stoneCount) || 1,
        pricePerCarat: Number(r.pricePerCarat) || 0,
        clarity: r.clarity.trim() || null,
        color: r.color.trim() || null,
        cut: r.cut.trim() || null,
        certificateLab: r.certificateLab,
        certificateNumber: r.certificateNumber.trim() || null,
      })),
  );
}

/**
 * Lignes de pierres répétables pour le formulaire « Nouvelle pièce ».
 * Transport par champ caché JSON : `ActionForm` sérialise un FormData opaque,
 * et le zod `gemstoneSchema` côté serveur valide nativement le tableau parsé.
 */
export function GemstoneLinesEditor() {
  const [rows, setRows] = useState<GemstoneDraft[]>([]);
  const hiddenRef = useRef<HTMLInputElement>(null);

  // ActionForm fait `form.reset()` après succès : ça ne vide pas un état React,
  // on écoute donc l'événement reset du formulaire parent.
  useEffect(() => {
    const form = hiddenRef.current?.closest("form");
    if (!form) return;
    const onReset = () => setRows([]);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function patchRow(index: number, patch: Partial<GemstoneDraft>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={hiddenRef} type="hidden" name="gemstonesJson" value={serialize(rows)} />

      {rows.map((row, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-sm border border-hairline bg-paper p-4"
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Nom de la pierre</span>
              <input
                value={row.name}
                onChange={(e) => patchRow(index, { name: e.target.value })}
                placeholder="Saphir de Ceylan"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Type</span>
              <select
                value={row.gemstoneType}
                onChange={(e) =>
                  patchRow(index, { gemstoneType: e.target.value as GemstoneType })
                }
                className={selectClass}
              >
                {(Object.keys(GEMSTONE_TYPE_LABELS) as GemstoneType[]).map((type) => (
                  <option key={type} value={type}>
                    {GEMSTONE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Poids (ct)</span>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={row.caratWeight}
                onChange={(e) => patchRow(index, { caratWeight: e.target.value })}
                placeholder="0.500"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Nombre</span>
              <input
                type="number"
                min="1"
                step="1"
                value={row.stoneCount}
                onChange={(e) => patchRow(index, { stoneCount: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Prix au carat (€)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.pricePerCarat}
                onChange={(e) => patchRow(index, { pricePerCarat: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Pureté</span>
              <input
                value={row.clarity}
                onChange={(e) => patchRow(index, { clarity: e.target.value })}
                placeholder="VS1"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Couleur</span>
              <input
                value={row.color}
                onChange={(e) => patchRow(index, { color: e.target.value })}
                placeholder="F"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Taille</span>
              <input
                value={row.cut}
                onChange={(e) => patchRow(index, { cut: e.target.value })}
                placeholder="Brillant"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Laboratoire</span>
              <select
                value={row.certificateLab}
                onChange={(e) =>
                  patchRow(index, { certificateLab: e.target.value as CertificateLab })
                }
                className={selectClass}
              >
                {(Object.keys(CERTIFICATE_LAB_LABELS) as CertificateLab[]).map((lab) => (
                  <option key={lab} value={lab}>
                    {CERTIFICATE_LAB_LABELS[lab]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>N° de certificat</span>
              <input
                value={row.certificateNumber}
                onChange={(e) => patchRow(index, { certificateNumber: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
              className={buttonGhost}
            >
              Retirer cette pierre
            </button>
          </div>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { ...EMPTY_DRAFT }])}
          className={buttonGhost}
        >
          Ajouter une pierre
        </button>
      </div>
    </div>
  );
}
