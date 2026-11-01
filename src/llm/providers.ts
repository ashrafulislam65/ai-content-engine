import { env } from "../config/env";

export class LlmError extends Error {
  constructor(
    message: string,
    public provider: string,
    public status?: number
  ) {
    super(message);
  }
}

type Compat = { url: string; key: () => string | undefined; jsonMode: boolean };

// All of these speak the OpenAI chat-completions format.
const OPENAI_COMPATIBLE: Record<string, Compat> = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: () => env.GROQ_API_KEY,
    jsonMode: true,
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    key: () => env.CEREBRAS_API_KEY,
    jsonMode: true,
  },
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    key: () => env.MISTRAL_API_KEY,
    jsonMode: true,
  },
  // Many free OpenRouter models reject response_format, so JSON mode is off there
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: () => env.OPENROUTER_API_KEY,
    jsonMode: false,
  },
};

export function hasKey(provider: string): boolean {
  if (provider === "gemini") return Boolean(env.GEMINI_API_KEY);
  return Boolean(OPENAI_COMPATIBLE[provider]?.key());
}

async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
    });
  } catch (err) {
    throw new LlmError(`${provider} network error: ${(err as Error).message}`, provider);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(`${provider} HTTP ${res.status}: ${text.slice(0, 300)}`, provider, res.status);
  }
  return res.json();
}

async function callCompat(
  provider: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  const cfg = OPENAI_COMPATIBLE[provider];
  const data = (await postJson(
    provider,
    cfg.url,
    { Authorization: `Bearer ${cfg.key()}` },
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
      ...(cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }
  )) as { choices?: { message?: { content?: string } }[] };

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LlmError(`${provider}/${model} returned an empty response`, provider);
  return text;
}

async function callGemini(model: string, system: string, user: string): Promise<string> {
  const data = (await postJson(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new LlmError(`gemini/${model} returned an empty response`, "gemini");
  return text;
}

export function callModel(
  provider: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  if (provider === "gemini") return callGemini(model, system, user);
  if (OPENAI_COMPATIBLE[provider]) return callCompat(provider, model, system, user);
  throw new LlmError(`Unknown provider "${provider}"`, provider);
}