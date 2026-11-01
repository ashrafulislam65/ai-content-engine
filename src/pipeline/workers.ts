import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { handlers } from "./handlers";
import { enqueueStage } from "./queues";
import { logStage } from "./service";
import { STAGES, STAGE_CONFIG, queueName } from "./stages";

type JobData = { videoId: string };

export function startWorkers() {
  return STAGES.map((stage) => {
    const cfg = STAGE_CONFIG[stage];

    const worker = new Worker<JobData>(
      queueName(stage),
      async (job) => {
        const { videoId } = job.data;
        const startedAt = Date.now();

        await prisma.video.update({
          where: { id: videoId },
          data: { status: cfg.status, errorMessage: null, failedStage: null },
        });
        await logStage(videoId, stage, "INFO", `Started (attempt ${job.attemptsMade + 1})`);

        await handlers[stage]({ videoId });

        await logStage(videoId, stage, "INFO", "Completed", Date.now() - startedAt);

        if (cfg.next) {
          await enqueueStage(cfg.next, videoId);
        } else {
          await prisma.video.update({
            where: { id: videoId },
            data: { status: "READY_FOR_REVIEW" },
          });
          await logStage(videoId, "pipeline", "INFO", "Video ready for review");
        }
      },
      {
        connection: redisConnection,
        concurrency: cfg.concurrency,
        limiter: cfg.limiter,
      }
    );

    worker.on("failed", async (job, err) => {
      if (!job) return;
      const { videoId } = job.data;
      await logStage(videoId, stage, "ERROR", err.message);

      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        await prisma.video.update({
          where: { id: videoId },
          data: { status: "FAILED", failedStage: cfg.status, errorMessage: err.message },
        });
        logger.error({ videoId, stage }, "Stage failed permanently");
      }
    });

    return worker;
  });
}