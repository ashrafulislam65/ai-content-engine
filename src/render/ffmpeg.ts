import { spawn } from "node:child_process";
import { env } from "../config/env";

type RunOptions = { cwd?: string; timeoutMs?: number };

// Runs ffmpeg and resolves when it exits with code 0. On failure the error carries the last lines of ffmpeg's output.
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;

  return new Promise<void>((resolve, reject) => {
    const child = spawn(env.FFMPEG_BIN, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Cannot start "${env.FFMPEG_BIN}": ${err.message}. Is FFmpeg installed and on PATH?`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1500)}`));
      }
    });
  });
}

// Duration of a media file in seconds, read with ffprobe
export function probeDuration(file: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      env.FFPROBE_BIN,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));

    child.on("error", (e) => reject(new Error(`Cannot start "${env.FFPROBE_BIN}": ${e.message}`)));
    child.on("close", (code) => {
      const seconds = Number(out.trim());
      if (code === 0 && Number.isFinite(seconds)) {
        resolve(seconds);
      } else {
        reject(new Error(`ffprobe failed: ${err.slice(-300)}`));
      }
    });
  });
}
