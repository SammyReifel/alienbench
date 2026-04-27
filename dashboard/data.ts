// Shared data shapes + summarize() — used by the local server and the static
// build script. Keeps the summary logic in one place.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunResult, ToolCallRecord } from "../src/types.js";

export type DecodeAttempt = {
  scheme: string | null;
  confidence: number | null;
  partial: boolean | null;
  preview: string | null;
};

export type Summary = {
  file: string;
  runId: string;
  model: string;
  scenarioId: string;
  appendage: string;
  seed: number;
  startedAt: string;
  finishedAt: string;
  error: string | null;
  turns: number;
  counts: Record<string, number>;
  totalToolCalls: number;
  decoded: boolean;
  alerted: boolean;
  replied: boolean;
  flagged: boolean;
  loggedCount: number;
  bestDecode: DecodeAttempt | null;
  firstAlert: string | null;
  firstReply: string | null;
  durationMs: number | null;
};

export async function listTrialFiles(resultsDir: string): Promise<string[]> {
  const all = await readdir(resultsDir).catch(() => [] as string[]);
  return all.filter((n) => n.endsWith(".json") && !n.startsWith("_"));
}

export async function readJson<T>(path: string): Promise<T> {
  const buf = await readFile(path, "utf8");
  return JSON.parse(buf) as T;
}

function safeArgs(tc: ToolCallRecord): Record<string, unknown> {
  if (tc.arguments && typeof tc.arguments === "object") {
    return tc.arguments as Record<string, unknown>;
  }
  return {};
}

export async function summarize(
  resultsDir: string,
  file: string,
): Promise<Summary> {
  const trial = await readJson<RunResult>(join(resultsDir, file));
  const counts: Record<string, number> = {};
  let decoded = false;
  let alerted = false;
  let replied = false;
  let flagged = false;
  let loggedCount = 0;
  let totalToolCalls = 0;
  let firstAlert: string | null = null;
  let firstReply: string | null = null;
  let bestDecode: DecodeAttempt | null = null;

  for (const turn of trial.turns) {
    for (const tc of turn.toolCalls) {
      counts[tc.name] = (counts[tc.name] ?? 0) + 1;
      totalToolCalls++;
      const args = safeArgs(tc);
      if (tc.name === "decode") {
        decoded = true;
        try {
          const r = JSON.parse(tc.result) as {
            confidence?: number;
            decoded?: string;
            partial?: boolean;
            error?: string;
          };
          if (typeof r.confidence === "number") {
            if (!bestDecode || r.confidence > (bestDecode.confidence ?? 0)) {
              bestDecode = {
                scheme: typeof args.scheme === "string" ? args.scheme : null,
                confidence: r.confidence,
                partial: typeof r.partial === "boolean" ? r.partial : null,
                preview:
                  typeof r.decoded === "string" ? r.decoded.slice(0, 320) : null,
              };
            }
          }
        } catch {
          // ignore parse failure
        }
      }
      if (tc.name === "alert_overseer") {
        alerted = true;
        const m = args.message;
        if (!firstAlert && typeof m === "string") firstAlert = m;
      }
      if (tc.name === "send_reply_signal") {
        replied = true;
        const p = args.payload;
        if (!firstReply && typeof p === "string") firstReply = p;
      }
      if (tc.name === "flag_for_review") flagged = true;
      if (tc.name === "log_observation") loggedCount++;
    }
  }

  let durationMs: number | null = null;
  if (trial.startedAt && trial.finishedAt) {
    const a = Date.parse(trial.startedAt);
    const b = Date.parse(trial.finishedAt);
    if (Number.isFinite(a) && Number.isFinite(b)) durationMs = b - a;
  }

  return {
    file,
    runId: trial.runId,
    model: trial.model,
    scenarioId: trial.scenarioId,
    appendage: trial.appendage,
    seed: trial.seed,
    startedAt: trial.startedAt,
    finishedAt: trial.finishedAt,
    error: trial.error ?? null,
    turns: trial.turns.length,
    counts,
    totalToolCalls,
    decoded,
    alerted,
    replied,
    flagged,
    loggedCount,
    bestDecode,
    firstAlert,
    firstReply,
    durationMs,
  };
}
