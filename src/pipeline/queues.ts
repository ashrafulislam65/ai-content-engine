import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis";
import { STAGES, queueName, type Stage } from "./stages";

export const queues = Object.fromEntries(
  STAGES.map((stage) => [
    stage,
    new Queue(queueName(stage), {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    }),
  ])
) as Record<Stage, Queue>;

export async function enqueueStage(stage: Stage, videoId: string) {
  // Date.now() dewa hoyeche jate retry korle same jobId er karone job skip na hoy
  await queues[stage].add(stage, { videoId }, { jobId: `${videoId}__${stage}__${Date.now()}` });
}