// Dev-only smoke test: pings a couple of Teracast model ids to confirm the
// API key works and the routing is sensible. Not part of `npm run run` or
// `npm run analyze`; invoke manually:
//   npx tsx scripts/probe-teracast.ts
import "dotenv/config";

const key = process.env.TERACAST_API_KEY!;
const base = "https://inference.teracast.net/v1";

async function call(model: string) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "say hi" }], max_tokens: 20 }),
  });
  console.log(`=== ${model}: ${res.status}`);
  console.log((await res.text()).slice(0, 300));
  console.log();
}

await call("zhipu-ai/glm-4-9b-chat");
await call("@cf/zhipu-ai/glm-4-9b-chat");
