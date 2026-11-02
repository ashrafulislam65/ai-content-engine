import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger";
import { toRelative, videoDir } from "../lib/storage";
import { VideoCandidate, downloadFile, searchVideos } from "./pixabay";

export type Clip = {
  index: number;
  keyword: string;
  provider: "pixabay";
  sourceId: number;
  pageUrl: string;
  file: string; // relative to the backend folder
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  duration: number; // length of the stock clip
  useSeconds: number; // how long the video should show this clip
  thumbnail: string | null;
  credit: { name: string; url: string };
};

// Used only when a keyword finds nothing usable
const FALLBACK_QUERIES = ["technology", "computer screen", "abstract background", "city night"];

// Prefer: portrait, relevant (earlier in results), long enough for its slot, not a huge file
function pickBest(cands: VideoCandidate[], used: Set<number>, slotSec: number): VideoCandidate | null {
  const scored = cands
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !used.has(c.id))
    .map(({ c, i }) => {
      let score = c.duration >= slotSec ? 100 : c.duration;
      if (c.duration > 40) score -= 50;
      if (c.file.height >= c.file.width) score += 40; // portrait fits a vertical video best
      score -= i * 3;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.c ?? null;
}

export async function fetchAssets(videoId: string, keywords: string[], audioSec: number) {
  if (keywords.length === 0) throw new Error("No visual keywords to search for");

  const dir = path.join(videoDir(videoId), "clips");
  await fs.mkdir(dir, { recursive: true });

  const slotSec = audioSec / keywords.length;
  const used = new Set<number>();
  const clips: Clip[] = [];
  let fallbacks = 0;

  for (const keyword of keywords) {
    let chosen: VideoCandidate | null = null;
    let usedQuery = keyword;

    for (const q of [keyword, ...FALLBACK_QUERIES]) {
      const best = pickBest(await searchVideos(q), used, slotSec);
      if (best) {
        chosen = best;
        usedQuery = q;
        break;
      }
    }

    if (!chosen) {
      logger.warn({ keyword }, "No usable clip found, skipping this keyword");
      continue;
    }
    if (usedQuery !== keyword) fallbacks++;
    used.add(chosen.id);

    const index = clips.length + 1;
    const abs = path.join(dir, `clip-${String(index).padStart(2, "0")}.mp4`);
    await downloadFile(chosen.file.link, abs);

    clips.push({
      index,
      keyword,
      provider: "pixabay",
      sourceId: chosen.id,
      pageUrl: chosen.pageUrl,
      file: toRelative(abs),
      width: chosen.file.width,
      height: chosen.file.height,
      orientation: chosen.file.height >= chosen.file.width ? "portrait" : "landscape",
      duration: chosen.duration,
      useSeconds: Math.round(slotSec * 100) / 100,
      thumbnail: chosen.thumbnail,
      credit: { name: chosen.creditName, url: chosen.creditUrl },
    });
  }

  if (clips.length < Math.min(3, keywords.length)) {
    throw new Error(`Only ${clips.length} usable clips found for ${keywords.length} keywords`);
  }
  return { clips, fallbacks };
}

// A retry should not download everything again if the files are already there
export async function assetsStillValid(assets: unknown): Promise<boolean> {
  if (!Array.isArray(assets) || assets.length === 0) return false;
  for (const a of assets) {
    const file = (a as { file?: unknown } | null)?.file;
    if (typeof file !== "string") return false;
    try {
      await fs.access(path.resolve(process.cwd(), file));
    } catch {
      return false;
    }
  }
  return true;
}
