---
name: argopia-survey
description: Discover openings from job boards → review queue
argument-hint: "[<url1> <url2> ...]"
---

You are running Argopia survey. Goal: produce a queue of openings at
`data/openings/<timestamp>.jsonl` — each line is one opening that
passed the keyword filter and is ready for `/argopia-review`.

Two modes, mutually exclusive:

- **Mode A — board survey** *(default, no URL args)*: per
  `working/sources.yaml`, fetch each `enabled: true` source by its
  `type`, applying source-side pre-filter via URL params
  (`criteria.target.*`). Discover URLs, dedup against `data/reviews.jsonl`,
  fetch each unseen URL's JD posting (cached at
  `data/postings/<sha1>.md`), run the keyword filter against title +
  posting body, and write filter survivors to `data/openings/`.
- **Mode B — ad-hoc URL inject** *(when one or more URLs are passed as
  positional args)*: skip discovery; treat the args as already-found
  URLs. Run them through the same dedup → posting fetch → filter →
  openings pipeline.

The argument is: $ARGUMENTS

## Flow

```
Pre-flight (initialized? mode detection)
  │
  ├─→ Mode A (default)
  │       Step 1  load criteria.target.* + sources.yaml; identify enabled set
  │       Step 2  dispatch per source type:
  │                 api     → node fetch.mjs
  │                 html    → source-surveyor sub-agent (one per source)
  │                 browser → skip + warn (deferred to v0.2)
  │               Each api/html dispatch writes to data/listings/<TS>-<source>.jsonl
  │       Step 3  prepare: dedup vs reviews.jsonl, identify posting cache misses
  │       Step 4  posting-fetcher sub-agent → write each cache-miss URL's body
  │               to data/postings/<sha1>.md
  │       Step 5  inject posting → filter → finalize → data/openings/<TS>.jsonl
  │       Step 6  summary
  │
  └─→ Mode B (URLs provided)
        Step 1  parse URLs from $ARGUMENTS
        Step 2  write data/listings/<TS>-manual.jsonl
        Steps 3-6  same as Mode A
```

## Pre-flight

1. **Initialized?** If `working/profile.yaml` does NOT exist:
   > working/ files are missing — initialize Argopia before surveying.

   STOP.

2. **Detect mode.** Default to Mode A. If `$ARGUMENTS` contains any
   token starting with `http://` or `https://`, switch to Mode B —
   jump to that section.

## Mode A — Board survey

### Step 1 — Load config + scaffolding

```bash
TS=$(date -u +%Y-%m-%dT%H%M)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p data/listings data/postings data/openings
```

Read both files **once each** and hold in context:

- `working/sources.yaml` — entries where `enabled: true`. Per-source data: `(name, type, base_url, link_selector, link_pattern, link_base, pagination, max_listings, filter_hints, field_map, array_path, skip_first)`.
- `working/criteria.yaml > target` — fields used for source pre-filter URL construction: `search_queries` (array), `remote_only`, `level`, `max_listing_age_days`, `preferred_timezones`, `acceptable_timezones`.

If the enabled list is **empty**:
```
no enabled sources in working/sources.yaml — flip `enabled: true` on at least one entry.
```
STOP.

### Step 2 — Discover URLs (dispatch per source)

For each enabled source, dispatch by `type`. URL construction,
pagination, and per-source bookkeeping live with the dispatcher (Node
or sub-agent) — the orchestrator just routes and aggregates.

Run dispatches **in parallel where possible**: kick off all api
`node fetch.mjs` calls + all html `source-surveyor` sub-agent spawns
in the same step, then wait for all to settle. Browser sources are
skipped synchronously (no spawn).

#### type: api → `node scripts/fetch.mjs`

Each api source's `filter_hints` documents its URL filter syntax.
Construct one URL per `target.search_queries` entry (or one bare
`base_url` if filter_hints says "URL filter: none"), URL-encoding
values. For each constructed URL:

```bash
node scripts/fetch.mjs <source-name> $TS '<constructed-url>'
```

The script handles HTTP retries with exponential backoff and appends
to `data/listings/$TS-<source-name>.jsonl`. If any invocation exits
non-zero, halt the survey:
> source <name> (type=api) fetch failed — see stderr above. Survey aborted.

#### type: html → spawn `source-surveyor` sub-agent

Spawn one sub-agent per html source via the Agent tool with
`subagent_type: "source-surveyor"`. The sub-agent owns URL
construction (per `filter_hints`), pagination (per `pagination`), and
per-source `max_listings` enforcement — see
`.claude/agents/source-surveyor.md` for the contract. The orchestrator
does not need to repeat that logic here.

Pass these inputs in the agent's `prompt`:
```
source_config: <full source entry from working/sources.yaml>
target:        <working/criteria.yaml > target subset>
ts:            <$TS>
```

`description`: `"Argopia survey: <source-name>"`.

The sub-agent returns one of:
- `{status: "ok", lines_written, queries_run, pages_per_query, stopped_via}`
- `{status: "error", reason}` — abort the survey

#### type: browser → skip with warning (deferred to v0.2)

Don't spawn anything. Log:
```
warn: source <name> requires browser MCP — skipping (deferred to v0.2).
```
Continue to other sources. A separate browser-MCP fetch agent will
land in v0.2.

#### After all dispatches settle

Aggregate results into a per-source map for the Step 6 summary.
Halt the survey if any source-surveyor returned `error`. Browser-typed
skips are warnings, not halts — note them in the summary and continue.

### Step 3 — Prepare unseen list

If `data/listings/$TS-*.jsonl` matches no files (every enabled source
returned empty or was skipped):
```
no listings discovered — every enabled source returned empty or was skipped.
```
STOP.

Run the prepare stage:

```bash
cat data/listings/$TS-*.jsonl \
  | node scripts/survey.mjs prepare \
  > /tmp/argopia-survey-$TS-unseen.jsonl \
  2> /tmp/argopia-survey-$TS-prepare.json
```

The stderr file is one JSON object: `{total, dup_within_survey,
dropped_reviewed, unseen, cache_hits, cache_misses, miss_targets}`,
where `miss_targets` is `[{url, posting_path}, ...]` — one entry per
cache-miss URL with its pre-computed cache path. Parse it in your
context — you'll need `miss_targets` for Step 4 and the counters for Step 6.

If `unseen == 0`:
```
all <total> discovered URLs are already in data/reviews.jsonl — nothing new to survey.
```
Clean up the temp files (`rm /tmp/argopia-survey-$TS-*`) and STOP.

### Step 4 — Fetch cache-miss postings (sub-agent, chunked)

If `miss_targets` is empty, skip this step.

Otherwise, dispatch via `posting-fetcher` sub-agent(s). The sub-agent
WebFetches each URL and writes the posting body to its supplied
`posting_path` — see `.claude/agents/posting-fetcher.md` for the
contract. Delegating keeps the WebFetch responses out of the
orchestrator's context.

#### Chunking

Each WebFetch response is ~2-3K tokens (in) and the corresponding
Write content is roughly the same (out). Per-URL agent context cost
runs ~4-5K tokens — higher than the body alone because tool inputs
also accumulate. To stay safely under Sonnet's 200K window with
margin for outliers (long JDs), cap each sub-agent at **20 URLs**.

- If `len(miss_targets) <= 20`: spawn **one** posting-fetcher with all targets.
- If `len(miss_targets) > 20`: split into chunks of **20 targets each**
  and spawn **N posting-fetcher agents in parallel** (one per chunk).

Build chunks in your context from the parsed `miss_targets` array —
no temp files needed (the array is small enough to slice in-context).

#### Spawn each chunk

For each chunk, spawn one sub-agent with:

```
subagent_type: "posting-fetcher"
description:   "Argopia survey: posting fetch (chunk N/M)"
prompt:        miss_targets: <this chunk's [{url, posting_path}, ...] entries>
               now:          <$NOW>
```

Spawn all chunks **in parallel** (one Agent tool-use message containing
N spawns).

#### Aggregate returns

Each sub-agent returns `{status, requested, fetched, failed, failed_urls}`.

- Sum `requested`, `fetched`, `failed` across all returns for the Step 6 summary
- Concatenate `failed_urls` lists
- If any sub-agent returned `{status: "error", reason}`, abort the survey

Per-URL failures inside any sub-agent are not survey-level failures;
those URLs simply get `description=null` at inject time and the filter
drops them.

### Step 5 — Inject + filter + finalize

Run the rest of the pipeline as a single shell chain:

```bash
cat /tmp/argopia-survey-$TS-unseen.jsonl \
  | node scripts/survey.mjs inject \
  | node scripts/filter.mjs \
  | node scripts/survey.mjs finalize \
  > data/openings/$TS.jsonl \
  2> /tmp/argopia-survey-$TS-filter.log
```

The filter stage logs counters (`in=…`, `kept=…`, `dropped_*=…`) to
the log file — read it for the summary in Step 6.

Clean up the prep artifacts:
```bash
rm /tmp/argopia-survey-$TS-unseen.jsonl
```

### Step 6 — Summary

Combine the prepare report + filter log. Print, tight (≤16 lines):

```
**Argopia survey** — <TS>

**Per source** *(URLs discovered)*
  ▸ <source1>: <N>
  ▸ <source2>: <N>
  ...
  (skipped: <browser-typed source names if any>)

**Pipeline**
  discovered:    <total>
  unseen:        <unseen>            (after history dedup)
  postings:      <cache_hits> cached / <fetched> newly fetched / <failed> failed
  filter:        <kept> kept / <total - kept> dropped
  openings:      data/openings/<TS>.jsonl (<kept> awaiting review)

**Next**: /argopia-review
```

If any source had 0 listings: `note: <source> returned 0 listings — pre-filter URL or selectors may have drifted.`

If a posting fetch failed: `note: <N> JDs unreachable (login walls / 404s) — see warnings above.`

Clean up the remaining survey artifacts:
```bash
rm /tmp/argopia-survey-$TS-prepare.json /tmp/argopia-survey-$TS-filter.log
```

## Mode B — Ad-hoc URL inject

1. **Parse URLs.** Extract every `http(s)://...` substring from
   `$ARGUMENTS`. Reject any malformed URL with a one-line warning;
   continue with the rest.

2. **Setup:**
   ```bash
   TS=$(date -u +%Y-%m-%dT%H%M)
   NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   mkdir -p data/listings data/postings data/openings
   ```

3. **Write listing line** (one JSONL line per URL, `source: "manual"`):
   ```bash
   for u in "${urls[@]}"; do
     printf '{"url":"%s","source":"manual"}\n' "$u"
   done > data/listings/$TS-manual.jsonl
   ```

4. **Continue at Step 3 of Mode A** — prepare → fetch postings →
   inject → filter → finalize → summary. Manual URLs go through the
   filter for consistency with openings semantics; if the filter
   rejects a manual URL, the URL will be silently dropped (re-run with
   adjusted criteria if you really want it through).

## Token discipline

- Don't read `working/*.yaml` twice — load once into context, reuse.
- All WebFetch traffic lives in sub-agents: `source-surveyor` for
  listing pages (one per html source), `posting-fetcher` for JD bodies
  (chunked at ~20 URLs each). The orchestrator only sees small JSON
  summaries from each.
- Don't recap openings contents — point users at the file.
- Posting cache makes re-runs cheap. Trust it; don't refetch what's already on disk.
