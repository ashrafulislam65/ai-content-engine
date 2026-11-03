export type RenderClip = { file: string; width: number; height: number };

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;

// One video segment per clip, all normalised to 1080x1920 at 30 fps so they can be joined.
function clipChain(i: number, clip: RenderClip, slotSec: number): string {
  const head = `[${i}:v]trim=duration=${slotSec.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS}`;

  // Portrait: fill the frame
  if (clip.height >= clip.width) {
    return `${head},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1[v${i}]`;
  }

  // Landscape: the sharp clip in the middle, a blurred copy of itself behind it.
  // The blur is done on a small copy and scaled up, which is much faster and looks the same.
  return [
    `${head},split=2[bgsrc${i}][fgsrc${i}]`,
    `[bgsrc${i}]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=6,scale=${WIDTH}:${HEIGHT},setsar=1[bg${i}]`,
    `[fgsrc${i}]scale=${WIDTH}:-2,setsar=1[fg${i}]`,
    `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2[v${i}]`,
  ].join(";");
}

export type SubtitleOptions = {
  file: string | null; // relative to ffmpeg's working folder, null = no captions
  font: string;
};

// Big bold white text with a black outline, in the lower middle of the screen
function subtitleFilter(opts: { file: string; font: string }): string {
  const font = opts.font.replace(/[^\w \-]/g, "");
  const style = [
    `FontName=${font}`,
    "FontSize=18",
    "Bold=1",
    "PrimaryColour=&H00FFFFFF",
    "OutlineColour=&H00000000",
    "BorderStyle=1",
    "Outline=3",
    "Shadow=0",
    "Alignment=2",
    "MarginV=70",
  ].join(",");
  return `subtitles=${opts.file}:force_style='${style}'`;
}

export function buildFilterGraph(clips: RenderClip[], totalSec: number, subs: SubtitleOptions): string {
  if (clips.length === 0) throw new Error("No clips to render");

  const slot = totalSec / clips.length;
  const parts = clips.map((clip, i) => clipChain(i, clip, slot));

  const labels = clips.map((_, i) => `[v${i}]`).join("");
  parts.push(`${labels}concat=n=${clips.length}:v=1:a=0[vcat]`);
  parts.push(subs.file ? `[vcat]${subtitleFilter({ file: subs.file, font: subs.font })}[vout]` : "[vcat]null[vout]");

  return parts.join(";");
}
