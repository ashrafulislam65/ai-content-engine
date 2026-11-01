import type { LogLevel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { enqueueStage } from "./queues";
import { stageFromStatus } from "./stages";

export async function logStage(
  videoId: string,
  stage: string,
  level: LogLevel,
  message: string,
  durationMs?: number
) {
  await prisma.pipelineLog.create({
    data: { videoId, stage, level, message, durationMs },
  });
}

export async function createVideoForTopic(topicId: string) {
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) throw new AppError(404, "Topic not found");

  const video = await prisma.video.create({ data: { topicId } });
  await prisma.topic.update({ where: { id: topicId }, data: { status: "IN_PROGRESS" } });
  await logStage(video.id, "pipeline", "INFO", "Video job created");
  await enqueueStage("script", video.id);
  return video;
}

export async function retryVideo(videoId: string) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new AppError(404, "Video not found");
  if (video.status !== "FAILED" || !video.failedStage) {
    throw new AppError(409, "Only failed videos can be retried");
  }

  const stage = stageFromStatus(video.failedStage);
  if (!stage) throw new AppError(409, "Unknown failed stage");

  await prisma.video.update({
    where: { id: videoId },
    data: { status: "QUEUED", errorMessage: null, failedStage: null },
  });
  await logStage(videoId, "pipeline", "INFO", `Retrying from stage: ${stage}`);
  await enqueueStage(stage, videoId);
}