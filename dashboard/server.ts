import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunResult } from "../src/types.js";
import { listTrialFiles, readJson, summarize } from "./data.js";

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
      const files = await listTrialFiles(RESULTS_DIR);
      const summaries = await Promise.all(files.map((f) => summarize(RESULTS_DIR, f)));
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
