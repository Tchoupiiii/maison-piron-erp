import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY manquante");
  client ??= new Resend(key);
  return client;
}

/**
 * Distingue « pas encore branché » de « envoi refusé ». Les actions qui
 * bloquent sur un échec d'envoi (reçu RGPD) doivent pouvoir se poursuivre tant
 * qu'aucun fournisseur n'est configuré, en le consignant.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendArgs): Promise<void> {
  const from = process.env.RESEND_FROM;
  if (!from) throw new Error("RESEND_FROM manquante");

  const { error } = await getClient().emails.send({ from, to, subject, html });
  if (error) throw new Error(`Envoi e-mail refusé : ${error.message}`);
}

/** Alerte interne : ne doit jamais faire échouer l'action métier appelante. */
export async function notifyAdmin(subject: string, html: string): Promise<void> {
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to) return;

  try {
    await sendEmail({ to, subject, html });
  } catch (error) {
    console.error("Alerte admin non délivrée", error);
  }
}
