#!/usr/bin/env node
// argopia fetch — fetch a type=api source's listings and emit normalized JSONL.
//
// Usage:
//   node scripts/fetch.mjs <source-name> <timestamp> [<url-override>]
//
// Reads:
//   working/sources.yaml — the source entry (type, base_url, array_path,
//                          skip_first, max_listings, field_map).
//
// Writes:
//   data/listings/<ts>-<source-name>.jsonl — append-mode (one normalized
//                                            record per line). Survey uses
//                                            a unique <ts> per run, so the
//                                            file starts empty and accumulates
//                                            across calls (e.g., one per
//                                            search_queries entry).
//
// Behavior:
//   - HTTP GET with 1 initial attempt + 3 retries (exp backoff: 1s, 2s, 4s).
//   - Applies array_path → skip_first → max_listings, then field_map.
//   - Emits only fields with values; downstream (survey.mjs inject) fills
//     the rest from the cached posting's front-matter.
//   - <url-override> overrides cfg.base_url (used when survey applies
//     source pre-filter via URL params).
//   - type=html is handled by the source-surveyor sub-agent (WebFetch);
//     type=browser is deferred to v0.2 (browser MCP).
//   - Exits 0 on success; 1 on config error or final retry failure.

import { readFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MAX_RETRIES = 3; // 1 initial attempt + up to 3 retries = 4 attempts total
const BASE_DELAY_MS = 1000; // backoff: 1s, 2s, 4s (exponential)

// "company.display_name" → obj.company.display_name. Missing segment → null.
function getDot(obj, path) {
  if (path == null) return obj;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return cur ?? null;
}

async function fetchWithRetry(url) {
  let lastErr;
  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    try {
      if (retry > 0) {
        await new Promise((r) =>
          setTimeout(r, BASE_DELAY_MS * (1 << (retry - 1))),
        );
      }
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Argopia/0.1)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      process.stderr.write(
        `fetch: attempt ${retry + 1}/${MAX_RETRIES + 1} failed: ${err.message}\n`,
      );
    }
  }
  throw lastErr;
}

function normalize(item, fieldMap, sourceName) {
  const id = getDot(item, fieldMap.id ?? "id");
  const title = getDot(item, fieldMap.title ?? "title");
  const url = getDot(item, fieldMap.url ?? "url");
  if (id == null || title == null || url == null) return null;

  // Emit only fields with values; survey.mjs inject fills the rest from
  // the cached posting's front-matter.
  const record = { url: String(url), title: String(title), source: sourceName };

  const company = fieldMap.company ? getDot(item, fieldMap.company) : null;
  if (company != null) record.company = company;

  const location = fieldMap.location ? getDot(item, fieldMap.location) : null;
  if (location != null) record.location = location;

  const date = fieldMap.date ? getDot(item, fieldMap.date) : null;
  if (date != null) record.posted_at = date;

  return record;
}

async function main() {
  const [, , sourceName, ts, urlOverride] = process.argv;
  if (!sourceName || !ts) {
    process.stderr.write(
      "usage: node scripts/fetch.mjs <source-name> <timestamp> [<url-override>]\n",
    );
    process.exit(1);
  }

  const sourcesPath = join(REPO_ROOT, "working", "sources.yaml");
  const sources = yaml.load(readFileSync(sourcesPath, "utf8"));
  const cfg = sources?.[sourceName];
  if (!cfg) {
    process.stderr.write(`fetch: source "${sourceName}" not in sources.yaml\n`);
    process.exit(1);
  }
  if (cfg.type !== "api") {
    process.stderr.write(
      `fetch: source "${sourceName}" has type=${cfg.type}, expected api\n`,
    );
    process.exit(1);
  }

  const fetchUrl = urlOverride || cfg.base_url;
  let payload;
  try {
    payload = await fetchWithRetry(fetchUrl);
  } catch (err) {
    process.stderr.write(
      `fetch: aborting after ${MAX_RETRIES + 1} attempts: ${err.message}\n`,
    );
    process.exit(1);
  }

  let items = cfg.array_path ? getDot(payload, cfg.array_path) : payload;
  if (!Array.isArray(items)) {
    process.stderr.write(
      `fetch: expected array at array_path="${cfg.array_path ?? "<root>"}", got ${typeof items}\n`,
    );
    process.exit(1);
  }
  if (cfg.skip_first) items = items.slice(1);

  const max = Number.isInteger(cfg.max_listings) ? cfg.max_listings : 100;
  items = items.slice(0, max);

  const fieldMap = cfg.field_map ?? {};
  const records = items
    .map((it) => normalize(it, fieldMap, sourceName))
    .filter(Boolean);

  const outDir = join(REPO_ROOT, "data", "listings");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${ts}-${sourceName}.jsonl`);
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  if (records.length) appendFileSync(outPath, lines + "\n");

  process.stderr.write(
    `fetch: ${sourceName} → ${records.length}/${items.length} records appended to ${outPath}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`fetch: ${err.message}\n`);
  process.exit(1);
});
