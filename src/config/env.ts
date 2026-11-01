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
    PEXELS_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.issues);
    process.exit(1);
}

export const env = parsed.data;