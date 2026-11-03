import { prisma } from "../lib/prisma";
import { parseClips, renderVideo } from "../render/service";

// Re-renders an existing video (script, voice and clips already done) without running the whole pipeline.
// Usage: npm run test:render            (newest video that has voice and clips)
//        npm run test:render -- <videoId>
async function main() {
  const wanted = process.argv[2];

  const candidates = wanted
    ? [await prisma.video.findUnique({ where: { id: wanted } })]
    : await prisma.video.findMany({
        where: { audioPath: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

  let video: (typeof candidates)[number] = null;
  for (const v of candidates) {
    if (v && v.audioPath && v.subtitlePath && v.audioDurationSec && parseClips(v.assets).length > 0) {
      video = v;
      break;
    }
  }
  if (!video || !video.audioPath || !video.subtitlePath || !video.audioDurationSec) {
    throw new Error("No video with voice and clips found. Run the full pipeline first (script, voice, assets).");
  }

  console.log(`Rendering ${video.id} (${video.title ?? "untitled"}) ...`);
  const r = await renderVideo({
    videoId: video.id,
    audioPath: video.audioPath,
    subtitlePath: video.subtitlePath,
    audioDurationSec: video.audioDurationSec,
    clips: parseClips(video.assets),
  });

  console.log(`Done in ${(r.tookMs / 1000).toFixed(1)}s`);
  console.log(`  video     : ${r.videoPath}  (${r.durationSec.toFixed(1)}s, ${(r.sizeBytes / 1_048_576).toFixed(1)} MB)`);
  console.log(`  thumbnail : ${r.thumbnailPath ?? "none"}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
