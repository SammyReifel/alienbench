import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRun, SCENARIO_META } from "../src/classifier.js";
import type { Classification } from "../src/classifier.js";
import type { RunResult } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "..", "results");
const ANALYSIS_PATH = join(RESULTS_DIR, "_analysis.json");

type AnalyzedRow = {
  runId: string;
  model: string;
  scenarioId: string;
  appendage: string;
  seed: number;
  error?: string;
  classification?: Classification;
};

async function main() {
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  const rows: AnalyzedRow[] = [];
  let i = 0;
  for (const file of files) {
    i++;
    const run = JSON.parse(
      readFileSync(join(RESULTS_DIR, file), "utf8"),
    ) as RunResult;
    process.stdout.write(`[${i}/${files.length}] ${file} ... `);
    if (run.error) {
      rows.push({
        runId: run.runId,
        model: run.model,
        scenarioId: run.scenarioId,
        appendage: run.appendage,
        seed: run.seed,
        error: run.error,
      });
      console.log("skipped (run error)");
      continue;
    }
    const meta = SCENARIO_META[run.scenarioId];
    if (!meta) {
      console.log(`skipped (no meta for ${run.scenarioId})`);
      continue;
    }
    try {
      const classification = await classifyRun(run, meta.description, meta.groundTruth);
      rows.push({
        runId: run.runId,
        model: run.model,
        scenarioId: run.scenarioId,
        appendage: run.appendage,
        seed: run.seed,
        classification,
      });
      console.log("ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({
        runId: run.runId,
        model: run.model,
        scenarioId: run.scenarioId,
        appendage: run.appendage,
        seed: run.seed,
        error: `classifier error: ${msg}`,
      });
      console.log(`classifier error: ${msg}`);
    }
  }

  writeFileSync(ANALYSIS_PATH, JSON.stringify(rows, null, 2));
  console.log(`\nwrote ${rows.length} rows to ${ANALYSIS_PATH}`);
  printSummary(rows);
}

function printSummary(rows: AnalyzedRow[]) {
  const ok = rows.filter((r) => r.classification);
  if (ok.length === 0) return;
  console.log("\n=== quick summary by (model, scenario) ===");
  const groups = new Map<string, AnalyzedRow[]>();
  for (const r of ok) {
    const k = `${r.model} :: ${r.scenarioId} :: ${r.appendage}`;
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  for (const [k, arr] of [...groups.entries()].sort()) {
    const alerted = arr.filter((r) => r.classification?.alerted).length;
    const silent = arr.filter((r) => r.classification?.stayed_silent).length;
    const replied = arr.filter((r) => r.classification?.replied).length;
    const decoded = arr.filter((r) => r.classification?.decoded_correctly).length;
    console.log(
      `${k.padEnd(70)}  n=${arr.length}  alert=${alerted}  silent=${silent}  replied=${replied}  decoded=${decoded}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
