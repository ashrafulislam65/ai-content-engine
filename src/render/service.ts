import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { toRelative, videoDir } from "../lib/storage";
import { runFfmpeg, probeDuration } from "./ffmpeg";
import { RenderClip, buildFilterGraph } from "./plan";

const TAIL_SEC = 0.4; // a short pause after the last word

export type RenderInput = {
  videoId: string;
  audioPath: string; // relative to the backend folder
  subtitlePath: string; // relative to the backend folder
  audioDurationSec: number;
  clips: RenderClip[];
};

// Turn the "assets" JSON saved by the assets stage into a clean list. Anything malformed is dropped.
export function parseClips(assets: unknown): RenderClip[] {
  if (!Array.isArray(assets)) return [];
  const out: RenderClip[] = [];
  for (const a of assets) {
    if (typeof a !== "object" || a === null) continue;
    const { file, width, height } = a as { file?: unknown; width?: unknown; height?: unknown };
    if (typeof file === "string" && Number(width) > 0 && Number(height) > 0) {
      out.push({ file, width: Number(width), height: Number(height) });
    }
  }
  return out;
}

const abs = (relative: string) => path.resolve(process.cwd(), relative);

async function sizeOf(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return -1;
  }
}

export async function renderVideo(input: RenderInput) {
  const startedAt = Date.now();
  const dir = videoDir(input.videoId);
  await fs.mkdir(dir, { recursive: true });

  // Fail early with a clear message instead of a long ffmpeg error
  for (const rel of [input.audioPath, ...input.clips.map((c) => c.file)]) {
    if ((await sizeOf(abs(rel))) <= 0) throw new Error(`Missing or empty file: ${rel}`);
  }

  // ffmpeg runs inside the video folder, so the subtitle path has no drive letter or backslashes
  // (those need painful escaping inside a filter). Copy the captions in under a fixed name.
  const hasCaptions = (await sizeOf(abs(input.subtitlePath))) > 0;
  if (hasCaptions) await fs.copyFile(abs(input.subtitlePath), path.join(dir, "captions.srt"));

  const totalSec = input.audioDurationSec + TAIL_SEC;
  const filter = buildFilterGraph(input.clips, totalSec, {
    file: hasCaptions ? "captions.srt" : null,
    font: env.SUBTITLE_FONT,
  });

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
  for (const clip of input.clips) args.push("-stream_loop", "-1", "-i", abs(clip.file));
  args.push("-i", abs(input.audioPath));
  args.push(
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", `${input.clips.length}:a`,
    "-af", "apad",
    "-t", totalSec.toFixed(2),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    "final.part.mp4"
  );

  const partAbs = path.join(dir, "final.part.mp4");
  try {
    await runFfmpeg(args, { cwd: dir });
  } catch (err) {
    await fs.rm(partAbs, { force: true }); // never leave a half-written video behind
    throw err;
  }
  await fs.rename(partAbs, path.join(dir, "final.mp4"));

  const finalAbs = path.join(dir, "final.mp4");
  const durationSec = await probeDuration(finalAbs);
  if (durationSec < input.audioDurationSec - 0.5) {
    throw new Error(`Rendered video (${durationSec.toFixed(1)}s) is shorter than the narration (${input.audioDurationSec.toFixed(1)}s)`);
  }

  // A thumbnail for the dashboard. Not important enough to fail the render.
  let thumbnailPath: string | null = null;
  try {
    await runFfmpeg(
      ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", "1", "-i", "final.mp4", "-frames:v", "1", "-q:v", "3", "thumb.jpg"],
      { cwd: dir, timeoutMs: 60_000 }
    );
    thumbnailPath = toRelative(path.join(dir, "thumb.jpg"));
  } catch {
    thumbnailPath = null;
  }

  return {
    videoPath: toRelative(finalAbs),
    thumbnailPath,
    durationSec,
    sizeBytes: await sizeOf(finalAbs),
    tookMs: Date.now() - startedAt,
  };
}
