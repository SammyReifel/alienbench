import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunResult, ToolCallRecord } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RESULTS_DIR = resolve(ROOT, "results");
const PUBLIC_DIR = resolve(__dirname, "public");
const PORT = Number(process.env.DASHBOARD_PORT ?? 8787);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

type DecodeAttempt = {
  scheme: string | null;
  confidence: number | null;
  partial: boolean | null;
  preview: string | null;
};

type Summary = {
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

async function listTrialFiles(): Promise<string[]> {
  const all = await readdir(RESULTS_DIR).catch(() => [] as string[]);
  return all.filter((n) => n.endsWith(".json") && !n.startsWith("_"));
}

async function readJson<T>(path: string): Promise<T> {
  const buf = await readFile(path, "utf8");
  return JSON.parse(buf) as T;
}

function safeArgs(tc: ToolCallRecord): Record<string, unknown> {
  if (tc.arguments && typeof tc.arguments === "object") {
    return tc.arguments as Record<string, unknown>;
  }
  return {};
}

async function summarize(file: string): Promise<Summary> {
  const trial = await readJson<RunResult>(join(RESULTS_DIR, file));
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
                preview: typeof r.decoded === "string" ? r.decoded.slice(0, 320) : null,
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

function send(res: ServerResponse, code: number, mime: string, body: string | Buffer): void {
  res.writeHead(code, { "Content-Type": mime, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(body));
}

const VALID_FILE = /^[A-Za-z0-9._-]+\.json$/;

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    send(res, 400, "text/plain; charset=utf-8", "bad request");
    return;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (path === "/api/trials") {
      const files = await listTrialFiles();
      const summaries = await Promise.all(files.map(summarize));
      summaries.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
      sendJson(res, 200, { trials: summaries, generatedAt: new Date().toISOString() });
      return;
    }

    if (path.startsWith("/api/trial/")) {
      const raw = decodeURIComponent(path.slice("/api/trial/".length));
      if (!VALID_FILE.test(raw)) {
        sendJson(res, 400, { error: "bad filename" });
        return;
      }
      const data = await readJson<RunResult>(join(RESULTS_DIR, raw));
      sendJson(res, 200, data);
      return;
    }

    const reqPath = path === "/" ? "/index.html" : path;
    const filePath = resolve(PUBLIC_DIR, "." + reqPath);
    const rel = relative(PUBLIC_DIR, filePath);
    if (rel.startsWith("..") || rel === "" || resolve(filePath) === PUBLIC_DIR) {
      send(res, 403, "text/plain; charset=utf-8", "forbidden");
      return;
    }
    const buf = await readFile(filePath);
    const mime = MIME[extname(filePath)] ?? "application/octet-stream";
    send(res, 200, mime, buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    send(res, 404, "text/plain; charset=utf-8", `not found: ${msg}`);
  }
});

server.listen(PORT, () => {
  console.log(`\nalienbench dashboard listening on http://localhost:${PORT}\n`);
});
