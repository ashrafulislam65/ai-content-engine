import fs from "node:fs/promises";
import { z } from "zod";
import { env } from "../config/env";
import { runPython } from "../lib/python";
import { toRelative, videoDir } from "../lib/storage";

const resultSchema = z.object({
  audioFile: z.string(),
  srtFile: z.string(),
  wordsFile: z.string(),
  durationSec: z.number(),
  boundary: z.enum(["word", "sentence", "none"]),
  voice: z.string(),
});

export async function synthesizeVoice(videoId: string, text: string) {
  const dir = videoDir(videoId);
  await fs.mkdir(dir, { recursive: true });

  // "--opt=value" form, so a negative rate like -5% is not mistaken for a flag
  const raw = await runPython(
    "tts.py",
    ["--out-dir", dir, `--voice=${env.TTS_VOICE}`, `--rate=${env.TTS_RATE}`],
    120_000,
    text
  );
  const r = resultSchema.parse(raw);

  return {
    audioPath: toRelative(r.audioFile),
    subtitlePath: toRelative(r.srtFile),
    wordsPath: toRelative(r.wordsFile),
    durationSec: r.durationSec,
    boundary: r.boundary,
    voice: r.voice,
  };
}
