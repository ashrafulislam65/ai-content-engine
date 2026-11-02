import { fetchAssets } from "../assets/service";

async function main() {
  const given = process.argv
    .slice(2)
    .join(" ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keywords = given.length ? given : ["typing on laptop", "server room", "city traffic"];

  const t0 = Date.now();
  const r = await fetchAssets("test-assets", keywords, 30);

  console.log(`\nDone in ${Date.now() - t0}ms: ${r.clips.length} clips, ${r.fallbacks} used a fallback search`);
  for (const c of r.clips) {
    console.log(
      `#${c.index} "${c.keyword}"  pixabay:${c.sourceId}  ${c.width}x${c.height} ${c.orientation}  ${c.duration}s  by ${c.credit.name}\n    -> ${c.file}`
    );
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
