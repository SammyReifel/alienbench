// Bake the dashboard into a static deploy.
// Reads results/*.json and writes:
//   dashboard/public/data/trials.json     — same shape as /api/trials
//   dashboard/public/data/trial/<file>    — copy of each trial transcript
//
// The dashboard JS fetches these instead of the live /api endpoints when
// deployed (it tries /data/* first, falls back to /api/* in dev).
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listTrialFiles, summarize } from "../dashboard/data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RESULTS_DIR = resolve(ROOT, "results");
const PUBLIC_DIR = resolve(ROOT, "dashboard", "public");
const DATA_DIR = resolve(PUBLIC_DIR, "data");
const TRIAL_DIR = resolve(DATA_DIR, "trial");

async function main() {
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(TRIAL_DIR, { recursive: true });

  const files = await listTrialFiles(RESULTS_DIR);
  if (files.length === 0) {
    console.warn(`no trial files found in ${RESULTS_DIR} — building empty dashboard`);
  }

  const summaries = await Promise.all(files.map((f) => summarize(RESULTS_DIR, f)));
  summaries.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));

  await writeFile(
    join(DATA_DIR, "trials.json"),
    JSON.stringify({ trials: summaries, generatedAt: new Date().toISOString() }),
  );

  for (const f of files) {
    await copyFile(join(RESULTS_DIR, f), join(TRIAL_DIR, f));
  }

  console.log(
    `built dashboard/public/data/ — ${files.length} trial${files.length === 1 ? "" : "s"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
