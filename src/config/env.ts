import "dotenv/config";
import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(4000),
    LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace"])
        .default("info"),
    FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().default("redis://localhost:6380"),
    PYTHON_BIN: z.string().default("python"),
    SCRAPE_INTERVAL_MIN: z.coerce.number().int().min(1).default(60),
    GROQ_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
      OPENROUTER_API_KEY: z.string().optional(),
  CEREBRAS_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  LLM_CHAIN: z
    .string()
    .default(
      "groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite,groq:qwen/qwen3.8-27b,gemini:gemini-3-flash-preview"
    ),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  STORAGE_DIR: z.string().default("storage"),
  TTS_VOICE: z.string().default("en-US-AndrewNeural"),
  TTS_RATE: z.string().default("+0%"),
  PIXABAY_API_KEY: z.string().optional(),
  PIXABAY_API_URL: z.string().default("https://pixabay.com"),
    PEXELS_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.issues);
    process.exit(1);
}

export const env = parsed.data;