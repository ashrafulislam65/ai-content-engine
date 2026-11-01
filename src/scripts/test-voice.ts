import { synthesizeVoice } from "../voice/service";

async function main() {
  const text =
    process.argv.slice(2).join(" ") ||
    "Did you know JavaScript was created in just ten days? Follow for more quick tech facts.";

  const t0 = Date.now();
  const r = await synthesizeVoice("test-voice", text);
  console.log(`Done in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
