import { formatEUR } from "@/lib/constants";
import type { Maison } from "@/lib/maison";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function layout(maison: Maison, body: string): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0a0a0a;max-width:560px">
${body}
<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#737373">
${maison.legalName} · ${maison.street}, ${maison.postalCode} ${maison.city} · ${maison.vatNumber}
</p>
</div>`;
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-BE", { dateStyle: "long" }).format(new Date(iso));

export function repairReceivedEmail(
  maison: Maison,
  args: {
    customerName: string;
    ref: string;
    description: string;
    deadline: string | null;
    estimatedPrice: number | null;
  },
) {
  const lines = [
    `<p>Bonjour ${escapeHtml(args.customerName)},</p>`,
    `<p>Nous avons bien réceptionné votre bijou à l'atelier. Votre dossier porte la référence <strong>${escapeHtml(args.ref)}</strong>.</p>`,
    `<p style="padding:12px;background:#f5f5f5;border-radius:8px">${escapeHtml(args.description)}</p>`,
  ];

  if (args.estimatedPrice !== null) {
    lines.push(`<p>Estimation : <strong>${formatEUR(args.estimatedPrice)}</strong>.</p>`);
  }
  if (args.deadline) {
    lines.push(`<p>Retrait prévu à partir du ${formatDate(args.deadline)}.</p>`);
  }
  lines.push(`<p>Nous vous préviendrons dès que la pièce sera prête.</p>`);

  return {
    subject: `Réception de votre bijou · ${args.ref}`,
    html: layout(maison, lines.join("\n")),
  };
}

export function repairReadyEmail(
  maison: Maison,
  args: {
    customerName: string;
    ref: string;
    description: string;
  },
) {
  return {
    subject: `Votre bijou est prêt · ${args.ref}`,
    html: layout(
      maison,
      [
        `<p>Bonjour ${escapeHtml(args.customerName)},</p>`,
        `<p>Votre bijou est prêt et vous attend en boutique.</p>`,
        `<p style="padding:12px;background:#f5f5f5;border-radius:8px">${escapeHtml(args.description)}<br><span style="color:#737373">Réf. ${escapeHtml(args.ref)}</span></p>`,
        `<p>Vous pouvez passer le récupérer ${maison.street}, aux heures d'ouverture de la boutique.</p>`,
      ].join("\n"),
    ),
  };
}

export function invoiceEmail(
  maison: Maison,
  args: {
    customerName: string;
    ref: string;
    totalAmount: number;
    dueAt: string | null;
  },
) {
  const lines = [
    `<p>Bonjour ${escapeHtml(args.customerName)},</p>`,
    `<p>Veuillez trouver ci-joint votre facture <strong>${escapeHtml(args.ref)}</strong> d'un montant de <strong>${formatEUR(args.totalAmount)}</strong> TTC.</p>`,
  ];
  if (args.dueAt) {
    lines.push(`<p>Échéance de paiement : ${formatDate(args.dueAt)}.</p>`);
  }
  lines.push(`<p>Nous vous remercions de votre confiance.</p>`);

  return {
    subject: `Facture ${args.ref} · ${maison.legalName}`,
    html: layout(maison, lines.join("\n")),
  };
}

/** Reçu d'exécution art. 17 — envoyé avant l'effacement des coordonnées. */
export function rgpdReceiptEmail(maison: Maison, args: { customerName: string }) {
  return {
    subject: "Confirmation d'anonymisation de vos données",
    html: layout(
      maison,
      [
        `<p>Bonjour ${escapeHtml(args.customerName)},</p>`,
        `<p>Conformément à votre demande et à l'article 17 du RGPD, vos données personnelles ont été effacées de nos systèmes : nom, adresse e-mail, numéro de téléphone, adresse postale et préférences.</p>`,
        `<p>Nos obligations comptables (art. 60 du Code de la TVA) nous imposent de conserver vos factures pendant sept ans. Elles sont désormais rattachées à un identifiant anonyme et ne permettent plus de vous identifier.</p>`,
        `<p>Ce message est le dernier que vous recevrez de notre part à cette adresse.</p>`,
      ].join("\n"),
    ),
  };
}
