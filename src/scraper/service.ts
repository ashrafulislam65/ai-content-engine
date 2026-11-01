import { z } from "zod";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { runPython } from "../lib/python";

const resultSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string().min(3).max(300),
      source: z.enum(["GOOGLE_TRENDS", "REDDIT", "HACKER_NEWS", "DEV_TO"]),
      sourceUrl: z.string().nullable().optional(),
      score: z.number().int().default(0),
    })
  ),
  errors: z.array(z.object({ source: z.string(), message: z.string() })).default([]),
});

export async function scrapeTopics(
    sources: string[] = ["hackernews", "devto"],
  limit = 20
) {
  const raw = await runPython("scrape_topics.py", [
    "--sources",
    sources.join(","),
    "--limit",
    String(limit),
  ]);
  const result = resultSchema.parse(raw);

  for (const e of result.errors) {
    logger.warn({ source: e.source }, `Scrape source failed: ${e.message}`);
  }

  // @@unique([title, source]) + skipDuplicates = already-known topics are ignored
  const created = await prisma.topic.createMany({
    data: result.topics.map((t) => ({
      title: t.title,
      source: t.source,
      sourceUrl: t.sourceUrl ?? null,
      score: t.score,
    })),
    skipDuplicates: true,
  });

  return {
    fetched: result.topics.length,
    created: created.count,
    failedSources: result.errors.length,
  };
}