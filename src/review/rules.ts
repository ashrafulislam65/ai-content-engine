import type { VideoStatus } from "@prisma/client";

export type Stage = "script" | "voice" | "assets" | "render";
export type Action = "approve" | "reject" | "regenerate" | "editScript";

// Which actions a reviewer may take, depending on where the video is in its life.
// Videos that are still being produced (QUEUED ... RENDERING) are locked on purpose.
const ALLOWED: Record<Action, readonly VideoStatus[]> = {
  approve: ["READY_FOR_REVIEW"],
  reject: ["READY_FOR_REVIEW", "APPROVED"],
  regenerate: ["READY_FOR_REVIEW", "APPROVED", "REJECTED", "FAILED"],
  editScript: ["READY_FOR_REVIEW", "REJECTED", "FAILED"],
};

export function canDo(action: Action, status: VideoStatus): boolean {
  return ALLOWED[action].includes(status);
}

export function allowedStatuses(action: Action): VideoStatus[] {
  return [...ALLOWED[action]];
}

export function allowedActions(status: VideoStatus): Action[] {
  return (Object.keys(ALLOWED) as Action[]).filter((a) => canDo(a, status));
}

// What to throw away when a stage is redone. Only what depends on that stage is cleared:
// a new narration needs a new render, but the stock clips can stay.
export type DbField =
  | "title"
  | "scriptText"
  | "visualKeywords"
  | "audioPath"
  | "audioDurationSec"
  | "subtitlePath"
  | "assets"
  | "videoPath";

export type ClearPlan = { fields: DbField[]; files: string[] };

const PLAN: Record<Stage, ClearPlan> = {
  script: {
    fields: ["title", "scriptText", "visualKeywords", "audioPath", "audioDurationSec", "subtitlePath", "assets", "videoPath"],
    files: ["voice.mp3", "subtitles.srt", "words.json", "captions.srt", "clips", "final.mp4", "final.part.mp4", "thumb.jpg"],
  },
  voice: {
    fields: ["audioPath", "audioDurationSec", "subtitlePath", "videoPath"],
    files: ["voice.mp3", "subtitles.srt", "words.json", "captions.srt", "final.mp4", "final.part.mp4", "thumb.jpg"],
  },
  assets: {
    fields: ["assets", "videoPath"],
    files: ["clips", "final.mp4", "final.part.mp4", "thumb.jpg"],
  },
  render: {
    fields: ["videoPath"],
    files: ["final.mp4", "final.part.mp4", "thumb.jpg", "captions.srt"],
  },
};

export function clearPlan(from: Stage): ClearPlan {
  return PLAN[from];
}

type Progress = {
  scriptText: string | null;
  audioPath: string | null;
  subtitlePath: string | null;
  audioDurationSec: number | null;
  visualKeywords: string[];
  assets: unknown;
};

// Redoing a stage only makes sense if everything before it exists
export function missingPrereq(from: Stage, v: Progress): string | null {
  if (from === "voice" && !v.scriptText) return "This video has no script yet, regenerate from the script stage";
  if (from === "assets" && (!v.audioDurationSec || v.visualKeywords.length === 0)) {
    return "The script or voice is missing, regenerate from an earlier stage";
  }
  if (from === "render") {
    const hasClips = Array.isArray(v.assets) && v.assets.length > 0;
    if (!v.audioPath || !v.subtitlePath || !v.audioDurationSec || !hasClips) {
      return "The voice or clips are missing, regenerate from an earlier stage";
    }
  }
  return null;
}

// "storage/videos/<id>/final.mp4" (as saved in the database) -> "/media/videos/<id>/final.mp4"
export function mediaUrl(relPath: string | null | undefined): string | null {
  if (!relPath) return null;
  const p = relPath.replace(/\\/g, "/");
  const m = /(?:^|\/)videos\/(.+)$/.exec(p);
  if (!m) return null;
  const parts = m[1].split("/");
  if (parts.some((part) => part === "" || part === "..")) return null;
  return `/media/videos/${parts.map(encodeURIComponent).join("/")}`;
}

export function thumbnailUrl(videoPath: string | null | undefined): string | null {
  const url = mediaUrl(videoPath);
  return url ? url.replace(/[^/]+$/, "thumb.jpg") : null;
}
