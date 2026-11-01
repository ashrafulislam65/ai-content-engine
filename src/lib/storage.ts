import path from "node:path";
import { env } from "../config/env";

// All generated media for one video lives in one folder: storage/videos/<videoId>/
export function videoDir(videoId: string): string {
  return path.resolve(process.cwd(), env.STORAGE_DIR, "videos", videoId);
}

// Paths saved in the database are relative to the backend folder and use "/" on every OS
export function toRelative(absPath: string): string {
  return path.relative(process.cwd(), absPath).split(path.sep).join("/");
}
