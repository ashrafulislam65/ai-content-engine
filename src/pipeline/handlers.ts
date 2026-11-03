import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { assetsStillValid, fetchAssets } from "../assets/service";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { generateScript } from "../llm/script";
import { parseClips, renderVideo } from "../render/service";
import { synthesizeVoice } from "../voice/service";
import { logStage } from "./service";
import type { Stage } from "./stages";

export type StageContext = { videoId: string };
export type StageHandler = (ctx: StageContext) => Promise<void>;

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

const assetsHandler: StageHandler = async ({ videoId }) => {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });

  if (!video.audioDurationSec || video.visualKeywords.length === 0) {
    throw new Error("Need the audio duration and visual keywords: the script and voice stages must finish first");
  }

  // Already downloaded (a later stage failed and we retried): skip
  if (await assetsStillValid(video.assets)) {
    logger.info({ videoId }, "[assets] already exist, skipping");
    return;
  }

  const r = await fetchAssets(videoId, video.visualKeywords, video.audioDurationSec);

  await prisma.video.update({
    where: { id: videoId },
    data: { assets: r.clips as unknown as Prisma.InputJsonValue },
  });
  await logStage(
    videoId,
    "assets",
    "INFO",
    `Downloaded ${r.clips.length} clips (${r.fallbacks} via fallback search)`
  );
};

const renderHandler: StageHandler = async ({ videoId }) => {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });

  if (!video.audioPath || !video.subtitlePath || !video.audioDurationSec) {
    throw new Error("Need the voice files first: the voice stage must finish before rendering");
  }
  const clips = parseClips(video.assets);
  if (clips.length === 0) {
    throw new Error("Need the downloaded clips first: the assets stage must finish before rendering");
  }

  // Already rendered (a retry after a later failure): skip
  if (video.videoPath) {
    const exists = await fs
      .access(path.resolve(process.cwd(), video.videoPath))
      .then(() => true, () => false);
    if (exists) {
      logger.info({ videoId }, "[render] already exists, skipping");
      return;
    }
  }

  const r = await renderVideo({
    videoId,
    audioPath: video.audioPath,
    subtitlePath: video.subtitlePath,
    audioDurationSec: video.audioDurationSec,
    clips,
  });

  await prisma.video.update({
    where: { id: videoId },
    data: { videoPath: r.videoPath },
  });
  await logStage(
    videoId,
    "render",
    "INFO",
    `Rendered ${r.durationSec.toFixed(1)}s video, ${(r.sizeBytes / 1_048_576).toFixed(1)} MB`,
    r.tookMs
  );
};

export const handlers: Record<Stage, StageHandler> = {
  script: scriptHandler,
  voice: voiceHandler,
  assets: assetsHandler,
  render: renderHandler,
};
