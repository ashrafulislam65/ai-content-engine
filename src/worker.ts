import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { startWorkers } from "./pipeline/workers";

const workers = startWorkers();
logger.info(`Started ${workers.length} pipeline workers`);

async function shutdown(signal: string) {
  logger.info(`${signal} received, closing workers...`);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));