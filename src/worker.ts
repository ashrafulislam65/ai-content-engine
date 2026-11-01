import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { startWorkers } from "./pipeline/workers";
import { scheduleScrape, startScrapeWorker } from "./scraper/queue";

const workers = [...startWorkers(), startScrapeWorker()];
logger.info(`Started ${workers.length} workers`);

scheduleScrape()
  .then(() => logger.info("Scrape scheduler ready"))
  .catch((err) => logger.error({ err }, "Failed to schedule scrape"));

async function shutdown(signal: string) {
  logger.info(`${signal} received, closing workers...`);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));