#!/usr/bin/env node
// argopia dashboard — render and serve the review dashboard.
//
// Usage:
//   node scripts/dashboard.mjs
//   npm run dashboard
//
// Reads:
//   data/reviews.jsonl              — canonical review records (one JSON per line).
//   data/postings/<sha>.md          — full posting body, inlined into the HTML at build time.
//   scripts/dashboard-template.html — HTML/CSS/JS template; `__REVIEWS_JSON__` sentinel gets replaced with the enriched review data.
//
// Writes:
//   reports/dashboard.html — self-contained snapshot, also served live.
//
// Behavior:
//   - Builds the dashboard HTML (template + enriched reviews data).
//   - Starts a local HTTP server at http://localhost:4242 and opens
//     the user's default browser.
//   - Runs until Ctrl+C.
//
// Triage state (apply / skip / save marks) persists in browser
// localStorage scoped to http://localhost:4242, surviving server
// restarts and browser reopens.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWS_PATH = join(REPO_ROOT, "data", "reviews.jsonl");
const TEMPLATE_PATH = join(REPO_ROOT, "scripts", "dashboard-template.html");
const OUT_DIR = join(REPO_ROOT, "reports");
const OUT_PATH = join(OUT_DIR, "dashboard.html");

const SERVE_HOST = "127.0.0.1";
const SERVE_PORT = 4242;

// Front-matter `posted` strings come in many shapes — ISO ("2026-05-08"),
// relative full ("3 weeks ago", "an hour ago"), abbreviated ("21h ago"),
// or "yesterday" / "just now". Parse once, server-side, into an epoch
// millisecond timestamp the client can sort directly.
const UNIT_MS = {
  minute: 60_000,
  min: 60_000,
  hour: 3_600_000,
  h: 3_600_000,
  day: 86_400_000,
  d: 86_400_000,
  week: 604_800_000,
  w: 604_800_000,
  month: 2_592_000_000,
  mo: 2_592_000_000,
  year: 31_536_000_000,
  y: 31_536_000_000,
};
function parsePostedTimestamp(value) {
  if (value == null || typeof value !== "string") return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  const lower = value.toLowerCase().trim();
  const now = Date.now();
  if (/^(just now|today|posted today)/.test(lower)) return now;
  if (/^(yesterday|posted yesterday)/.test(lower)) return now - UNIT_MS.day;
  const m = lower.match(
    /^(?:posted\s+)?(?:(\d+)|an?)\s*(minute|min|hour|h|day|d|week|w|month|mo|year|y)s?\s+ago/,
  );
  if (m && UNIT_MS[m[2]] != null) {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    return now - n * UNIT_MS[m[2]];
  }
  return null;
}

function loadJsonl(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      process.stderr.write(`dashboard: skip malformed line in ${path}\n`);
    }
  }
  return out;
}

function readPostingBody(postingPath) {
  const abs = join(REPO_ROOT, postingPath);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, "utf8");
  let body = raw;
  if (raw.startsWith("---\n")) {
    const close = raw.indexOf("\n---\n", 4);
    if (close !== -1) body = raw.slice(close + 5).trimStart();
  }
  return body;
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
}

// The dashboard is fully self-contained — bodies are inlined at build
// time. The server only serves the HTML itself; nothing else.
function serve(html) {
  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/dashboard.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(
        `dashboard: port ${SERVE_PORT} is in use — stop the other process and retry.\n`,
      );
      process.exit(1);
    }
    throw err;
  });
  server.listen(SERVE_PORT, SERVE_HOST, () => {
    const url = `http://localhost:${SERVE_PORT}/`;
    process.stdout.write(`dashboard: ${url}\n`);
    process.stdout.write("press Ctrl+C to stop\n");
    openBrowser(url);
  });
}

function buildHtml(reviews) {
  const enriched = reviews.map((r) => ({
    ...r,
    body: r.posting_path ? readPostingBody(r.posting_path) : null,
    posted_ts: parsePostedTimestamp(r.posted),
  }));

  // Escape "</" so the JSON literal can't terminate the script tag.
  const reviewsJson = JSON.stringify(enriched).replace(/<\//g, "<\\/");
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  return template.replace("__REVIEWS_JSON__", reviewsJson);
}

function main() {
  if (!existsSync(REVIEWS_PATH)) {
    process.stderr.write(
      "dashboard: data/reviews.jsonl not found — run /argopia-review first.\n",
    );
    process.exit(1);
  }
  if (!existsSync(TEMPLATE_PATH)) {
    process.stderr.write(
      `dashboard: template missing at ${TEMPLATE_PATH} — repo is incomplete.\n`,
    );
    process.exit(1);
  }

  const reviews = loadJsonl(REVIEWS_PATH);
  if (reviews.length === 0) {
    process.stderr.write("dashboard: data/reviews.jsonl is empty.\n");
    process.exit(1);
  }

  const html = buildHtml(reviews);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, html);

  const counts = { apply: 0, research: 0, skip: 0 };
  for (const r of reviews) {
    if (r.recommendation in counts) counts[r.recommendation]++;
  }
  process.stdout.write(
    `  ${reviews.length} reviews — ${counts.apply} apply / ${counts.research} research / ${counts.skip} skip\n`,
  );
  serve(html);
}

try {
  main();
} catch (err) {
  process.stderr.write(`dashboard: ${err.message}\n`);
  process.exit(1);
}
