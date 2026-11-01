import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { generateScript } from "../llm/script";
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

export const handlers: Record<Stage, StageHandler> = {
  script: scriptHandler,
  voice: placeholder("voice"),
  assets: placeholder("assets"),
  render: placeholder("render"),
};