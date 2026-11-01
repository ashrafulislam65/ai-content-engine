import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { generateScript } from "../llm/script";
import { synthesizeVoice } from "../voice/service";
import { logStage } from "./service";
import type { Stage } from "./stages";

export type StageContext = { videoId: string };
export type StageHandler = (ctx: StageContext) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function placeholder(label: string): StageHandler {
  return async ({ videoId }) => {
    logger.info({ videoId }, `[${label}] placeholder running`);
    await sleep(1500);
  };
}

const scriptHandler: StageHandler = async ({ videoId }) => {
  const video = await prisma.video.findUniqueOrThrow({
    where: { id: videoId },
    include: { topic: true },
  });

  // Already generated (e.g. a later stage failed and we retried): don't spend another API call
  if (video.scriptText) {
    logger.info({ videoId }, "[script] already exists, skipping");
    return;
  }

  const result = await generateScript(video.topic.title, video.topic.summary);

  await prisma.video.update({
    where: { id: videoId },
    data: {
      title: result.title,
      scriptText: result.scriptText,
      visualKeywords: result.visualKeywords,
    },
  });
  await logStage(videoId, "script", "INFO", `Script generated via ${result.provider}`);
};

const voiceHandler: StageHandler = async ({ videoId }) => {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });

  if (!video.scriptText) {
    throw new Error("No script text yet: the script stage must finish first");
  }

  // Already done (a later stage failed and we retried): skip
  if (video.audioPath && video.subtitlePath && video.audioDurationSec) {
    logger.info({ videoId }, "[voice] already exists, skipping");
    return;
  }

  const r = await synthesizeVoice(videoId, video.scriptText);

  await prisma.video.update({
    where: { id: videoId },
    data: {
      audioPath: r.audioPath,
      subtitlePath: r.subtitlePath,
      audioDurationSec: r.durationSec,
    },
  });
  await logStage(
    videoId,
    "voice",
    "INFO",
    `Voice generated (${r.voice}, ${r.boundary} timestamps, ${r.durationSec.toFixed(1)}s)`
  );
};

export const handlers: Record<Stage, StageHandler> = {
  script: scriptHandler,
  voice: voiceHandler,
  assets: placeholder("assets"),
  render: placeholder("render"),
};
