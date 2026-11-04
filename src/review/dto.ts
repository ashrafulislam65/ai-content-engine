import type { VideoStatus } from "@prisma/client";
import { allowedActions, mediaUrl, thumbnailUrl } from "./rules";

type TopicLite = { id: string; title: string; source: string };

type ListRow = {
  id: string;
  status: VideoStatus;
  title: string | null;
  audioDurationSec: number | null;
  videoPath: string | null;
  failedStage: VideoStatus | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  topic: TopicLite;
};

type DetailRow = ListRow & {
  audioPath: string | null;
  subtitlePath: string | null;
  assets: unknown;
};

export type ClipInfo = {
  index: number;
  keyword: string;
  orientation: string;
  width: number;
  height: number;
  duration: number;
  useSeconds: number;
  thumbnail: string | null;
  pageUrl: string;
  file: string;
  creditName: string;
  creditUrl: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

// The "assets" JSON was written by our own code, but be forgiving: drop anything that does not look right.
export function readClips(assets: unknown): ClipInfo[] {
  if (!Array.isArray(assets)) return [];
  const out: ClipInfo[] = [];
  for (const a of assets) {
    if (typeof a !== "object" || a === null) continue;
    const c = a as Record<string, unknown>;
    if (typeof c.file !== "string") continue;
    const credit = typeof c.credit === "object" && c.credit !== null ? (c.credit as Record<string, unknown>) : {};
    out.push({
      index: num(c.index),
      keyword: str(c.keyword),
      orientation: str(c.orientation),
      width: num(c.width),
      height: num(c.height),
      duration: num(c.duration),
      useSeconds: num(c.useSeconds),
      thumbnail: str(c.thumbnail) || null,
      pageUrl: str(c.pageUrl),
      file: c.file,
      creditName: str(credit.name),
      creditUrl: str(credit.url),
    });
  }
  return out;
}

// Who to thank in the video description. One line per creator and clip page.
export function creditsFrom(clips: ClipInfo[]) {
  const seen = new Set<string>();
  const out: { keyword: string; name: string; url: string; pageUrl: string }[] = [];
  for (const c of clips) {
    if (!c.creditName) continue;
    const key = `${c.creditName}|${c.pageUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ keyword: c.keyword, name: c.creditName, url: c.creditUrl, pageUrl: c.pageUrl });
  }
  return out;
}

export function toListItem(v: ListRow) {
  return {
    id: v.id,
    status: v.status,
    title: v.title,
    topic: { id: v.topic.id, title: v.topic.title, source: v.topic.source },
    durationSec: v.audioDurationSec,
    videoUrl: mediaUrl(v.videoPath),
    thumbnailUrl: thumbnailUrl(v.videoPath),
    failedStage: v.failedStage,
    errorMessage: v.errorMessage,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    actions: allowedActions(v.status),
  };
}

// Everything the database has (so existing scripts keep working) plus ready-to-use URLs and allowed actions
export function toDetail<T extends DetailRow>(v: T) {
  const clips = readClips(v.assets);
  return {
    ...v,
    media: {
      video: mediaUrl(v.videoPath),
      thumbnail: thumbnailUrl(v.videoPath),
      audio: mediaUrl(v.audioPath),
      captions: mediaUrl(v.subtitlePath),
    },
    clips: clips.map((c) => ({ ...c, url: mediaUrl(c.file) })),
    credits: creditsFrom(clips),
    actions: allowedActions(v.status),
  };
}
