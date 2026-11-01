import { env } from "../config/env";
import { logger } from "../lib/logger";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { LlmError, callModel, hasKey } from "./providers";
import { scriptSchema } from "./schema";

type ChainItem = { provider: string; model: string };

// "groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite" -> ordered list.
// Split on the FIRST colon only (model ids can contain ':' and '/').
function parseChain(): ChainItem[] {
  return env.LLM_CHAIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const i = entry.indexOf(":");
      if (i < 1) return [];
      return [{ provider: entry.slice(0, i).toLowerCase(), model: entry.slice(i + 1) }];
    })
    .filter((item) => hasKey(item.provider));
}

// A failing model is skipped for a while so later jobs don't waste time on it.
const cooldownUntil = new Map<string, number>();
const keyOf = (c: ChainItem) => `${c.provider}:${c.model}`;

function cooldownMs(status?: number): number {
  if (status === 429) return 2 * 60_000; // rate limited
  if (status === 401 || status === 403 || status === 404) return 30 * 60_000; // bad key / model gone
  return 30_000;
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
  const chain = parseChain();
  if (chain.length === 0) {
    throw new Error("No usable model in LLM_CHAIN. Check API keys and LLM_CHAIN in .env");
  }

  // Prefer models that are not cooling down; if all are, try them anyway.
  const now = Date.now();
  const ready = chain.filter((c) => (cooldownUntil.get(keyOf(c)) ?? 0) <= now);
  const candidates = ready.length > 0 ? ready : chain;

  const errors: string[] = [];

  for (const item of candidates) {
    const label = keyOf(item);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await callModel(item.provider, item.model, SYSTEM_PROMPT, buildUserPrompt(topicTitle));
        const parsed = scriptSchema.parse(extractJson(raw));
        return {
          title: parsed.title,
          scriptText: cleanSpokenText(parsed.script_text),
          visualKeywords: parsed.visual_keywords.map((k) => k.toLowerCase()),
          provider: label,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${label}#${attempt}: ${message.slice(0, 160)}`);
        logger.warn({ model: label, attempt }, `LLM attempt failed: ${message.slice(0, 160)}`);

        // API-level failure (rate limit, network, bad key, model gone): next model.
        // Invalid JSON / schema mismatch: retry the same model once.
        if (err instanceof LlmError) {
          cooldownUntil.set(label, Date.now() + cooldownMs(err.status));
          break;
        }
      }
    }
  }

  throw new Error(`All models in the chain failed. ${errors.join(" | ")}`);
}