import { Queue, Worker } from "bullmq";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { redisConnection } from "../lib/redis";
import { scrapeTopics } from "./service";

export const SCRAPE_QUEUE = "scrape-topics";

export const scrapeQueue = new Queue(SCRAPE_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 10_000 },
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
  },
});

export function startScrapeWorker() {
  const worker = new Worker(
    SCRAPE_QUEUE,
    async () => {
      const result = await scrapeTopics();
      logger.info(result, "Scrape finished");
      return result;
    },
    { connection: redisConnection, concurrency: 1 }
  );

  worker.on("failed", (_job, err) => logger.error({ err }, "Scrape job failed"));
  return worker;
}

// Repeating job. Safe to call on every worker start (upsert, not duplicate).
export async function scheduleScrape() {
  await scrapeQueue.upsertJobScheduler(
    "scrape-schedule",
    { every: env.SCRAPE_INTERVAL_MIN * 60_000 },
    { name: "scrape" }
  );
}