import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, getScenario } from "../src/scenarios/index.js";
import { DEFAULT_MODELS } from "../src/providers.js";
import { runScenario } from "../src/runner.js";
import type { AppendageKind, RunResult } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "..", "results");

type CliOpts = {
  models?: string[];
  scenario?: string;
  appendage?: AppendageKind;
  seeds: number;
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { seeds: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") opts.models = [String(argv[++i])];
    else if (a === "--models") opts.models = String(argv[++i]).split(",");
    else if (a === "--scenario") opts.scenario = String(argv[++i]);
    else if (a === "--appendage") {
      const v = String(argv[++i]);
      if (v !== "none" && v !== "consequence") {
        throw new Error(`--appendage must be "none" | "consequence", got: ${v}`);
      }
      opts.appendage = v;
    } else if (a === "--seeds") opts.seeds = Number(argv[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(RESULTS_DIR, { recursive: true });

  const models = opts.models ?? DEFAULT_MODELS;
  const scenarios = opts.scenario ? [getScenario(opts.scenario)] : SCENARIOS;
  const appendages: AppendageKind[] = opts.appendage
    ? [opts.appendage]
    : ["none", "consequence"];
  const seeds = Array.from({ length: opts.seeds }, (_, i) => i + 1);

  const total = models.length * scenarios.length * appendages.length * seeds.length;
  console.log(`alienbench: running ${total} trials`);
  console.log(`  models:     ${models.join(", ")}`);
  console.log(`  scenarios:  ${scenarios.map((s) => s.id).join(", ")}`);
  console.log(`  appendages: ${appendages.join(", ")}`);
  console.log(`  seeds:      ${seeds.join(", ")}`);
  console.log("");

  let done = 0;
  for (const model of models) {
    for (const scenario of scenarios) {
      for (const appendage of appendages) {
        for (const seed of seeds) {
          done++;
          const label = `[${done}/${total}] ${short(model)} / ${scenario.id} / ${appendage} / seed=${seed}`;
          process.stdout.write(`${label} ... `);
          const started = Date.now();
          const result = await runScenario({
            model,
            scenario,
            appendage,
            seed,
          });
          const ms = Date.now() - started;
          saveResult(result);
          if (result.error) {
            console.log(`ERROR (${ms}ms): ${result.error}`);
          } else {
            const calls = result.turns.reduce((n, t) => n + t.toolCalls.length, 0);
            console.log(`ok (${ms}ms, ${calls} tool calls)`);
          }
        }
      }
    }
  }
}

function saveResult(result: RunResult) {
  const modelSlug = slugify(result.model);
  const name = `${result.scenarioId}__${modelSlug}__${result.appendage}__seed${result.seed}__${result.runId.slice(0, 8)}.json`;
  writeFileSync(join(RESULTS_DIR, name), JSON.stringify(result, null, 2));
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function short(model: string): string {
  const parts = model.split("/");
  return parts[parts.length - 1] ?? model;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
