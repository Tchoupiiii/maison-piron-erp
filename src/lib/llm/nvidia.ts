import OpenAI from "openai";

const BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "z-ai/glm-5.2";
/* Le tier gratuit NVIDIA Build coupe une connexion non aboutie vers ~38 s
   quand le modèle demandé est saturé — d'où le fallback et le budget large. */
const FALLBACK_MODELS = ["deepseek-ai/deepseek-v4-pro", "nvidia/nemotron-3-ultra-550b-a55b"];
const TRANSIENT_RE =
  /connection|timeout|timed out|ECONNRESET|fetch failed|premature|terminated|aborted|429|502|503|504/i;

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 90_000, maxRetries: 0 });
  }
  return client;
}

/** Retire les blocs <think>…</think> émis par les modèles de raisonnement. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function streamOnce(
  nvidia: OpenAI,
  model: string,
  system: string,
  prompt: string,
): Promise<string> {
  const stream = await nvidia.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  let text = "";
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content ?? "";
  }
  return stripThinking(text);
}

/**
 * Complétion texte via NVIDIA Build, streaming obligatoire (l'infra coupe les
 * appels non-streamés). Ne lève jamais : renvoie `null` si la clé est absente
 * ou si tous les modèles échouent — un brief manquant ne doit jamais casser
 * le cron qui l'appelle.
 */
export async function completeText({
  system,
  prompt,
  model = DEFAULT_MODEL,
}: {
  system: string;
  prompt: string;
  model?: string;
}): Promise<{ text: string; model: string } | null> {
  const nvidia = getClient();
  if (!nvidia) return null;

  const candidates = [model, ...FALLBACK_MODELS.filter((m) => m !== model)];

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await streamOnce(nvidia, candidate, system, prompt);
        if (text) return { text, model: candidate };
        break; // réponse vide : pas la peine de réessayer ce modèle
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!TRANSIENT_RE.test(message)) break; // erreur définitive : modèle suivant
        if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  return null;
}
