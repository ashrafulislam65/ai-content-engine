import { logger } from "../lib/logger";
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

export const handlers: Record<Stage, StageHandler> = {
  script: placeholder("script"),
  voice: placeholder("voice"),
  assets: placeholder("assets"),
  render: placeholder("render"),
};