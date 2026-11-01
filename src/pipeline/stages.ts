import type { VideoStatus } from "@prisma/client";

export const STAGES = ["script", "voice", "assets", "render"] as const;
export type Stage = (typeof STAGES)[number];

export const queueName = (stage: Stage) => `pipeline-${stage}`;

type StageConfig = {
  status: VideoStatus; // video er status jokhon ei stage cholche
  next: Stage | null; // porer stage (null = shesh)
  concurrency: number; // ekshathe koyta job
  limiter?: { max: number; duration: number }; // rate limit (free API er jonno)
};

export const STAGE_CONFIG: Record<Stage, StageConfig> = {
  script: {
    status: "SCRIPTING",
    next: "voice",
    concurrency: 2,
    limiter: { max: 10, duration: 60_000 }, // minute e max 10 ta LLM call
  },
  voice: { status: "VOICING", next: "assets", concurrency: 2 },
  assets: { status: "FETCHING_ASSETS", next: "render", concurrency: 2 },
  render: { status: "RENDERING", next: null, concurrency: 1 }, // CPU heavy
};

export function stageFromStatus(status: VideoStatus): Stage | undefined {
  return STAGES.find((s) => STAGE_CONFIG[s].status === status);
}