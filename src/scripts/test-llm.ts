import { generateScript } from "../llm/script";

async function main() {
  const topic = process.argv.slice(2).join(" ") || "Why JavaScript {} + [] equals 0";
  const t0 = Date.now();
  const r = await generateScript(topic);

  console.log(`\nModel : ${r.provider}  (${Date.now() - t0}ms)`);
  console.log(`Title : ${r.title}`);
  console.log(`Words : ${r.scriptText.split(/\s+/).length}\n`);
  console.log(r.scriptText);
  console.log(`\nKeywords: ${r.visualKeywords.join(", ")}\n`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});