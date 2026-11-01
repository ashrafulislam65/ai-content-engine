import { env } from "../config/env";

export class LlmError extends Error {
  constructor(
    message: string,
    public provider: string
  ) {
    super(message);
  }
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
    throw new LlmError(`${provider} HTTP ${res.status}: ${text.slice(0, 300)}`, provider);
  }
  return res.json();
}

export async function callGroq(system: string, user: string): Promise<string> {
  const data = (await postJson(
    "groq",
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    {
      model: env.GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
      response_format: { type: "json_object" },
    }
  )) as { choices?: { message?: { content?: string } }[] };

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LlmError("groq returned an empty response", "groq");
  return text;
}

export async function callGemini(system: string, user: string): Promise<string> {
  const data = (await postJson(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
    { "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new LlmError("gemini returned an empty response", "gemini");
  return text;
}