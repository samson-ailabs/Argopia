#!/usr/bin/env node
// argopia survey — pipeline glue for /argopia-survey.
//
// Usage:
//   cat data/listings/<TS>-*.jsonl | node scripts/survey.mjs prepare
//   cat unseen.jsonl                | node scripts/survey.mjs inject
//   cat survivors.jsonl             | node scripts/survey.mjs finalize
//
// Reads:
//   data/reviews.jsonl     — prepare uses for URL dedup (canonical review ledger).
//   data/postings/<sha>.md — inject uses for body + front-matter parse.
//
// Behavior — three subcommands, each a stdin → stdout JSONL filter:
//   prepare:  listings JSONL → unseen JSONL (records not yet reviewed,
//             enriched with posting_path).
//             stderr: JSON report incl. cache-miss URLs the
//             posting-fetcher sub-agent must fetch next.
//
//   inject:   unseen JSONL with posting_path → same JSONL with
//             description = first 1500 chars of the cached posting BODY
//             (YAML front-matter stripped). Also fills company /
//             location / posted_at from the front-matter IF the listing
//             didn't already have them (preserves api-source data).
//             Records whose posting is missing get description=null and
//             are passed through (filter drops them via no-positive).
//
//   finalize: filter survivors JSONL → openings JSONL — emits only
//             {url, posting_path}. Title / company / location / posted_at
//             live in the cached posting's front-matter; review parses
//             them there.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWS_PATH = join(REPO_ROOT, "data", "reviews.jsonl");
const POSTING_INJECT_LIMIT = 1500; // chars fed to filter (filter only reads first 800)

function loadReviewedSet() {
  if (!existsSync(REVIEWS_PATH)) return new Set();
  const set = new Set();
  for (const line of readFileSync(REVIEWS_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r.url) set.add(r.url);
    } catch {
      // skip malformed line; reviews.jsonl is best-effort
    }
  }
  return set;
}

function postingPathFor(url) {
  const sha = createHash("sha1").update(url).digest("hex");
  return join("data", "postings", `${sha}.md`);
}

// JD pages often render relative dates ("3 weeks ago", "Yesterday") that
// Date.parse can't handle. Returns ISO string or null.
function parseRelativeDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return null;

  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();

  const lower = value.toLowerCase().trim();
  const now = Date.now();
  const DAY = 86_400_000;

  if (/^(just now|today|posted today)/.test(lower)) {
    return new Date(now).toISOString();
  }
  if (/^(yesterday|posted yesterday)/.test(lower)) {
    return new Date(now - DAY).toISOString();
  }

  const m = lower.match(
    /^(?:posted\s+)?(?:(\d+)|an?)\s+(minute|hour|day|week|month|year)s?\s+ago/,
  );
  if (m) {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    const ms = {
      minute: 60_000,
      hour: 3_600_000,
      day: DAY,
      week: 7 * DAY,
      month: 30 * DAY,
      year: 365 * DAY,
    }[m[2]];
    return new Date(now - n * ms).toISOString();
  }

  return null;
}

async function readJsonl(input) {
  const out = [];
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      process.stderr.write("survey: skip invalid JSON line\n");
    }
  }
  return out;
}

async function cmdPrepare() {
  const reviewed = loadReviewedSet();
  const records = await readJsonl(process.stdin);

  const dupGuard = new Set();
  const unseen = [];
  let dupWithinSurvey = 0;
  let droppedReviewed = 0;
  let cacheHits = 0;
  const missTargets = [];

  for (const r of records) {
    if (!r.url) continue;
    if (reviewed.has(r.url)) {
      droppedReviewed++;
      continue;
    }
    if (dupGuard.has(r.url)) {
      dupWithinSurvey++;
      continue;
    }
    dupGuard.add(r.url);

    const postingPath = postingPathFor(r.url);
    const absPosting = join(REPO_ROOT, postingPath);
    if (existsSync(absPosting)) {
      cacheHits++;
    } else {
      missTargets.push({ url: r.url, posting_path: postingPath });
    }

    unseen.push({
      ...r,
      posting_path: postingPath,
    });
  }

  for (const r of unseen) process.stdout.write(JSON.stringify(r) + "\n");

  const report = {
    total: records.length,
    dup_within_survey: dupWithinSurvey,
    dropped_reviewed: droppedReviewed,
    unseen: unseen.length,
    cache_hits: cacheHits,
    cache_misses: missTargets.length,
    miss_targets: missTargets,
  };
  process.stderr.write(JSON.stringify(report) + "\n");
}

async function cmdInject() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try {
      r = JSON.parse(t);
    } catch {
      process.stderr.write("survey inject: skip invalid JSON line\n");
      continue;
    }
    if (r.posting_path) {
      const abs = join(REPO_ROOT, r.posting_path);
      if (existsSync(abs)) {
        const posting = readFileSync(abs, "utf8");
        let body = posting;
        let frontMatter = null;
        if (posting.startsWith("---\n")) {
          const close = posting.indexOf("\n---\n", 4);
          if (close !== -1) {
            try {
              frontMatter = yaml.load(posting.slice(4, close));
            } catch {
              // malformed front-matter — treat as no metadata
            }
            body = posting.slice(close + 5).trimStart();
          }
        }
        // Fill IF NULL — preserves api-source data already populated via
        // field_map, fills the gaps for html sources.
        if (frontMatter && typeof frontMatter === "object") {
          if (r.company == null && frontMatter.company)
            r.company = frontMatter.company;
          if (r.location == null && frontMatter.location)
            r.location = frontMatter.location;
          if (r.posted_at == null && frontMatter.posted) {
            const iso = parseRelativeDate(frontMatter.posted);
            if (iso) r.posted_at = iso;
          }
        }
        r.description = body.slice(0, POSTING_INJECT_LIMIT);
      } else {
        r.description = null;
      }
    }
    process.stdout.write(JSON.stringify(r) + "\n");
  }
}

async function cmdFinalize() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try {
      r = JSON.parse(t);
    } catch {
      process.stderr.write("survey finalize: skip invalid JSON line\n");
      continue;
    }
    process.stdout.write(
      JSON.stringify({ url: r.url, posting_path: r.posting_path }) + "\n",
    );
  }
}

const sub = process.argv[2];
const dispatch = {
  prepare: cmdPrepare,
  inject: cmdInject,
  finalize: cmdFinalize,
};

if (!dispatch[sub]) {
  process.stderr.write("usage: survey.mjs <prepare|inject|finalize>\n");
  process.exit(1);
}

dispatch[sub]().catch((err) => {
  process.stderr.write(`survey ${sub}: ${err.message}\n`);
  process.exit(1);
});
