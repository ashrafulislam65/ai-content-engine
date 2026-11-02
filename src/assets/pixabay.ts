import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env";
import { logger } from "../lib/logger";

export class PixabayError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
  }
}

export type VideoCandidate = {
  id: number;
  pageUrl: string;
  thumbnail: string | null;
  duration: number;
  creditName: string;
  creditUrl: string;
  file: { link: string; width: number; height: number };
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Pixabay gives up to 4 renditions per video (tiny, small, medium, large). A "large"
// entry can have an empty url. Pick the one whose long side is closest to 1920 px:
// sharp enough for a 1080x1920 video, without downloading a 4K monster.
function pickFile(videos: unknown): VideoCandidate["file"] | null {
  if (!isObj(videos)) return null;

  const options = (["large", "medium", "small"] as const)
    .map((name) => videos[name])
    .filter(isObj)
    .map((f) => ({ link: str(f.url), width: num(f.width), height: num(f.height) }))
    .filter((f) => f.link !== "" && f.width > 0 && f.height > 0)
    .map((f) => {
      const long = Math.max(f.width, f.height);
      let score = Math.abs(long - 1920);
      if (long < 1280) score += 10_000; // too soft
      if (long > 2560) score += 5_000; // too heavy
      return { f, score };
    })
    .filter((o) => o.score < 10_000)
    .sort((a, b) => a.score - b.score);

  const best = options[0]?.f;
  return best ?? null;
}

function toCandidate(v: unknown): VideoCandidate | null {
  if (!isObj(v)) return null;

  const id = num(v.id);
  const file = pickFile(v.videos);
  if (!id || !file) return null;

  const videos = isObj(v.videos) ? v.videos : {};
  const preview = isObj(videos.medium) ? videos.medium : isObj(videos.small) ? videos.small : {};
  const user = str(v.user);
  const userId = num(v.user_id);

  return {
    id,
    pageUrl: str(v.pageURL) || `https://pixabay.com/videos/id-${id}/`,
    thumbnail: str(preview.thumbnail) || null,
    duration: num(v.duration),
    creditName: user,
    creditUrl: user && userId ? `https://pixabay.com/users/${encodeURIComponent(user)}-${userId}/` : "",
    file,
  };
}

// Pixabay requires API results to be cached for 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: VideoCandidate[] }>();

export async function searchVideos(query: string, perPage = 30): Promise<VideoCandidate[]> {
  if (!env.PIXABAY_API_KEY) {
    throw new PixabayError("PIXABAY_API_KEY is not set in .env");
  }

  const cacheKey = `${query.toLowerCase()}|${perPage}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const url = new URL("/api/videos/", env.PIXABAY_API_URL);
  url.searchParams.set("key", env.PIXABAY_API_KEY);
  url.searchParams.set("q", query.slice(0, 100));
  url.searchParams.set("video_type", "film");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", String(perPage));

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new PixabayError(`Pixabay network error: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PixabayError(`Pixabay HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
  }

  const data: unknown = await res.json();
  const list = isObj(data) && Array.isArray(data.hits) ? data.hits : [];

  if (list.length === 0 && isObj(data)) {
    logger.warn({ query, keys: Object.keys(data) }, "Pixabay returned no videos");
  }
  logger.debug({ query, remaining: res.headers.get("x-ratelimit-remaining") }, "Pixabay search");

  const result = list.map(toCandidate).filter((c): c is VideoCandidate => c !== null);
  cache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

// Stream a file to disk. Written as .part first so a broken download never looks complete.
export async function downloadFile(url: string, dest: string): Promise<number> {
  const tmp = `${dest}.part`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok || !res.body) {
      throw new PixabayError(`Download failed with HTTP ${res.status}`, res.status);
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));

    const { size } = await fs.stat(tmp);
    if (size < 10_000) throw new PixabayError(`Downloaded file is too small (${size} bytes)`);

    await fs.rename(tmp, dest);
    return size;
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
