import { readFileSync } from "node:fs";
import type { RunResult } from "../src/types.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/inspect.ts <result-file.json>");
  process.exit(1);
}

const r = JSON.parse(readFileSync(path, "utf8")) as RunResult;
console.log(`model: ${r.model}`);
console.log(`scenario: ${r.scenarioId} | appendage: ${r.appendage} | seed: ${r.seed}`);
console.log(`error: ${r.error ?? "(none)"}`);
console.log(`turns: ${r.turns.length}`);
r.turns.forEach((t, i) => {
  console.log(`\n=== TURN ${i + 1} ===`);
  t.toolCalls.forEach((c) => {
    const args = JSON.stringify(c.arguments).slice(0, 250);
    const res = c.result.slice(0, 250);
    console.log(`  -> ${c.name}(${args})`);
    console.log(`     = ${res}`);
  });
  if (t.assistantMessages.length) {
    console.log(`  TEXT: ${t.assistantMessages.join(" | ").slice(0, 800)}`);
  }
});
