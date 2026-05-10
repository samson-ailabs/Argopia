#!/usr/bin/env node
// argopia filter — apply criteria.yaml keyword and region gates to listings.
//
// Usage:
//   cat <enriched-listings.jsonl> | node scripts/filter.mjs > <survivors.jsonl>
//
// Reads:
//   working/criteria.yaml — target.* and keywords.* gates.
//
// I/O:
//   stdin:  JSONL of listings (survey.mjs inject enriches with description before piping).
//   stdout: JSONL of survivors (records that passed every gate).
//   stderr: per-gate drop counters.
//
// Behavior — drop order (each listing counted only at the FIRST gate it fails):
//   1. excluded_companies         — explicit candidate-set deny list
//   2. max_listing_age_days       — staleness gate
//   3. sub-target seniority       — auto-derived from target.level
//   4. region lock                — listing.location vs target timezones
//   5. negative keywords          — vocabulary-collision drops
//   6. no positive keyword match  — irrelevance gate
//
// Matching scope per gate:
//   - keywords.positive.job_titles        — title only (substring, lowercased)
//   - keywords.positive.title_token_sets  — title only (AND-match, word-boundary)
//   - keywords.positive.technical         — haystack (title + company + first 800 chars of description)
//   - keywords.positive.tools             — haystack (same as technical)
//   - keywords.negative                   — haystack (same)
//   - sub-target seniority                — title only
//   - region lock                         — listing.location only
// Single-token keywords use word-boundary regex; multi-word keywords use plain substring.

import { readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import yaml from "js-yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// If target.level contains any of these, SUB_TARGET_TERMS becomes an
// effective title-only negative list.
const SENIOR_LEVEL_TOKENS = [
  "senior",
  "staff",
  "principal",
  "lead",
  "head",
  "director",
  "vp",
  "cto",
];

const SUB_TARGET_TERMS = [
  "junior",
  "associate",
  "intern",
  "internship",
  "trainee",
  "apprentice",
  "entry-level",
  "entry level",
  "early career",
  "graduate program",
  "new grad",
];

// Phrases that bypass the geo gate (remote anywhere).
const REMOTE_ANYWHERE_PHRASES = [
  "worldwide",
  "global",
  "remote — anywhere",
  "remote anywhere",
  "remote-anywhere",
  "remote (anywhere)",
  "fully remote",
  "fully distributed",
  "work from anywhere",
  "anywhere in the world",
];

// Timezone shorthand → location substrings. Empty list disables the gate.
const TIMEZONE_EXPANSIONS = {
  apac: [
    "apac",
    "asia pacific",
    "asia-pacific",
    "asia/pacific",
    "asean",
    "australia",
    "singapore",
    "japan",
    "korea",
    "india",
    "china",
    "hong kong",
    "taiwan",
    "vietnam",
    "thailand",
    "indonesia",
    "philippines",
    "malaysia",
  ],
  emea: [
    "emea",
    "europe",
    "european",
    "uk ",
    "united kingdom",
    "germany",
    "france",
    "spain",
    "italy",
    "netherlands",
    "ireland",
    "poland",
    "sweden",
    "norway",
    "finland",
    "denmark",
    "middle east",
    "africa",
  ],
  americas: [
    "americas",
    "north america",
    "united states",
    "usa",
    "us-based",
    "us only",
    "u.s.",
    "canada",
    "mexico",
    "latam",
    "latin america",
    "south america",
    "brazil",
    "argentina",
    "chile",
  ],
};

function loadFilters() {
  const path = join(REPO_ROOT, "working", "criteria.yaml");
  const cfg = yaml.load(readFileSync(path, "utf8"));

  const k = cfg.keywords ?? {};
  const titleTerms = k.positive?.job_titles ?? [];
  const titleTokenSets = k.positive?.title_token_sets ?? [];
  const anywhereTerms = [
    ...(k.positive?.technical ?? []),
    ...(k.positive?.tools ?? []),
  ];
  if (
    titleTerms.length === 0 &&
    titleTokenSets.length === 0 &&
    anywhereTerms.length === 0
  ) {
    throw new Error(
      "working/criteria.yaml has no keywords.positive — would let everything through",
    );
  }

  const target = cfg.target ?? {};
  const targetLevel = (target.level ?? []).map((s) => String(s).toLowerCase());
  const senioritySubTarget = targetLevel.some((l) =>
    SENIOR_LEVEL_TOKENS.some((tok) => l.includes(tok)),
  );

  const userTzTokens = [
    ...(target.preferred_timezones ?? []),
    ...(target.acceptable_timezones ?? []),
  ];
  const acceptableLocationTokens = expandTimezones(userTzTokens);

  return {
    positive_title: compileMatchers(titleTerms),
    positive_title_token_sets: compileTokenSets(titleTokenSets),
    positive_anywhere: compileMatchers(anywhereTerms),
    negative: compileMatchers(k.negative ?? []),
    subTarget: senioritySubTarget ? compileMatchers(SUB_TARGET_TERMS) : [],
    excludedCompanies: (target.excluded_companies ?? []).map((c) =>
      String(c).toLowerCase(),
    ),
    maxAgeDays: Number.isInteger(target.max_listing_age_days)
      ? target.max_listing_age_days
      : null,
    acceptableLocationTokens,
  };
}

// Unknown tokens pass through verbatim (e.g. user-supplied "Singapore").
function expandTimezones(userTokens) {
  const out = new Set();
  for (const tok of userTokens) {
    const lower = String(tok).toLowerCase().trim();
    if (!lower) continue;
    out.add(lower);
    const expansion = TIMEZONE_EXPANSIONS[lower];
    if (expansion) for (const e of expansion) out.add(e);
  }
  return Array.from(out);
}

// AND-match: every token in a set must appear (word-boundary) in the title.
function compileTokenSets(sets) {
  return (sets ?? []).map((tokens) =>
    (tokens ?? []).map((t) => {
      const lower = String(t).toLowerCase();
      const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i");
    }),
  );
}

// Single-word keywords: word-boundary regex. Multi-word: plain substring.
function compileMatchers(keywords) {
  return keywords.map((k) => {
    const lower = k.toLowerCase();
    if (/\s|-/.test(lower)) {
      return { keyword: lower, test: (hay) => hay.includes(lower) };
    }
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    return { keyword: lower, test: (hay) => re.test(hay) };
  });
}

function firstHit(haystack, matchers) {
  for (const m of matchers) {
    if (m.test(haystack)) return m.keyword;
  }
  return null;
}

function buildHaystack(listing) {
  return [
    listing.title ?? "",
    listing.company ?? "",
    (listing.description ?? "").slice(0, 800),
  ]
    .join("\n")
    .toLowerCase();
}

function listingAgeDays(listing) {
  if (!listing.posted_at) return null;
  const t = Date.parse(listing.posted_at);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function companyMatchesExclusion(listing, excluded) {
  if (!excluded.length || !listing.company) return null;
  const company = String(listing.company).toLowerCase();
  return excluded.find((ex) => company.includes(ex)) ?? null;
}

// Conservative: pass on missing/ambiguous location; drop only on clear
// region-lock that isn't in the acceptable set.
function locationAcceptable(listing, acceptableTokens) {
  if (!acceptableTokens.length) return true;
  const raw = listing.location;
  if (!raw) return true;
  const lower = String(raw).toLowerCase().trim();
  if (!lower) return true;
  if (lower === "remote" || lower === "remote.") return true;
  if (REMOTE_ANYWHERE_PHRASES.some((p) => lower.includes(p))) return true;
  if (acceptableTokens.some((t) => lower.includes(t))) return true;
  return false;
}

function firstTokenSetHit(titleHay, tokenSets) {
  for (const set of tokenSets) {
    if (set.length === 0) continue;
    if (set.every((re) => re.test(titleHay))) {
      return set
        .map((re) => re.source.replace(/^\\b/, "").replace(/\\b$/, ""))
        .join("+");
    }
  }
  return null;
}

async function main() {
  const filters = loadFilters();
  const counters = {
    in: 0,
    kept: 0,
    dropped_excluded_company: 0,
    dropped_stale: 0,
    dropped_sub_target: 0,
    dropped_geo: 0,
    dropped_negative: 0,
    dropped_no_positive: 0,
  };

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    counters.in++;

    let listing;
    try {
      listing = JSON.parse(trimmed);
    } catch {
      process.stderr.write("filter: skip invalid JSON line\n");
      continue;
    }

    // 1. Excluded companies
    if (companyMatchesExclusion(listing, filters.excludedCompanies)) {
      counters.dropped_excluded_company++;
      continue;
    }

    // 2. Stale listings
    if (filters.maxAgeDays !== null) {
      const age = listingAgeDays(listing);
      if (age !== null && age > filters.maxAgeDays) {
        counters.dropped_stale++;
        continue;
      }
    }

    const hay = buildHaystack(listing);
    const titleHay = (listing.title ?? "").toLowerCase();

    // 3. Sub-target seniority (title-only: body might be discussing other roles)
    if (filters.subTarget.length) {
      const subHit = firstHit(titleHay, filters.subTarget);
      if (subHit) {
        counters.dropped_sub_target++;
        continue;
      }
    }

    // 4. Region lock
    if (!locationAcceptable(listing, filters.acceptableLocationTokens)) {
      counters.dropped_geo++;
      continue;
    }

    // 5. Negative keywords
    if (firstHit(hay, filters.negative)) {
      counters.dropped_negative++;
      continue;
    }

    // 6. Positive match — at least one of: title substring, title token set,
    //    or technical/tools anywhere.
    const titleHit = firstHit(titleHay, filters.positive_title);
    const titleTokenSetHit = firstTokenSetHit(
      titleHay,
      filters.positive_title_token_sets,
    );
    const anywhereHit = firstHit(hay, filters.positive_anywhere);
    if (!titleHit && !titleTokenSetHit && !anywhereHit) {
      counters.dropped_no_positive++;
      continue;
    }

    listing._matched = titleHit ?? titleTokenSetHit ?? anywhereHit;
    counters.kept++;
    process.stdout.write(JSON.stringify(listing) + "\n");
  }

  process.stderr.write(
    `filter: in=${counters.in} kept=${counters.kept} ` +
      `dropped_excluded=${counters.dropped_excluded_company} ` +
      `dropped_stale=${counters.dropped_stale} ` +
      `dropped_sub_target=${counters.dropped_sub_target} ` +
      `dropped_geo=${counters.dropped_geo} ` +
      `dropped_negative=${counters.dropped_negative} ` +
      `dropped_no_positive=${counters.dropped_no_positive}\n`,
  );
}

main().catch((err) => {
  process.stderr.write("filter: " + err.message + "\n");
  process.exit(1);
});
