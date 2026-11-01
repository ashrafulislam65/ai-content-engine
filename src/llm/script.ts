import { env } from "../config/env";
import { logger } from "../lib/logger";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { LlmError, callGemini, callGroq } from "./providers";
import { scriptSchema } from "./schema";

type Provider = {
  name: "groq" | "gemini";
  call: (system: string, user: string) => Promise<string>;
};

// Order = priority. Providers without an API key are skipped.
function getProviders(): Provider[] {
  const list: Provider[] = [];
  if (env.GROQ_API_KEY) list.push({ name: "groq", call: callGroq });
  if (env.GEMINI_API_KEY) list.push({ name: "gemini", call: callGemini });
  return list;
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

// The text goes to a TTS engine: strip emojis and markdown leftovers.
function cleanSpokenText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateScript(topicTitle: string) {
  const providers = getProviders();
  if (providers.length === 0) {
    throw new Error("No LLM API key configured. Set GROQ_API_KEY and/or GEMINI_API_KEY in .env");
  }

  const errors: string[] = [];

  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await provider.call(SYSTEM_PROMPT, buildUserPrompt(topicTitle));
        const parsed = scriptSchema.parse(extractJson(raw));
        return {
          title: parsed.title,
          scriptText: cleanSpokenText(parsed.script_text),
          visualKeywords: parsed.visual_keywords.map((k) => k.toLowerCase()),
          provider: provider.name,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name}#${attempt}: ${message.slice(0, 200)}`);
        logger.warn({ provider: provider.name, attempt }, `LLM attempt failed: ${message.slice(0, 200)}`);

        // API-level failure (rate limit, network, bad key): go to the next provider.
        // Invalid JSON / schema mismatch: retry the same provider once.
        if (err instanceof LlmError) break;
      }
    }
  }

  throw new Error(`All LLM providers failed. ${errors.join(" | ")}`);
}