---
name: argopia-review
description: Score the queued openings against profile + criteria, append to data/reviews.jsonl
argument-hint: "[--limit N]"
---

Score each queued opening's fit against the candidate's
`working/profile.yaml` and `working/criteria.yaml` using the rubric
inlined below. Output is one JSON line per JD appended to
`data/reviews.jsonl` — the canonical record consumed by the dashboard
and `/argopia-advise`. No per-JD markdown reports; the dashboard owns
the deep-dive view.

The argument is: $ARGUMENTS

## Pre-flight

1. **Initialized?** If `working/profile.yaml` does NOT exist:
   > Argopia isn't set up yet. Run `/argopia-onboard <path-to-cv.pdf>`.

   STOP.

2. Load these once into context — they apply to every JD:
   - `working/profile.yaml` — identity (candidate, experience, projects,
     publications, awards, tech_stack).
   - `working/criteria.yaml` — preferences (target, must_haves,
     deal_breakers, nice_to_haves, keywords).
   - `data/reviews.jsonl` if it exists — capture the full file content
     as a string (you'll concatenate new lines onto it at the end of
     the loop). Also extract each line's `url` into a Set for dedup
     (skip malformed lines).

   The rubric is **inlined below**. Apply it to every JD using the
   profile + criteria as context.

3. Find the **newest** openings file:
   ```bash
   ls -t data/openings/*.jsonl 2>/dev/null | head -1
   ```
   If none exists, tell the user to run `/argopia-survey` first and STOP.

4. Read the openings file. Each line is a minimal queue record:
   `{url, posting_path}`. All metadata (title, company, location,
   posted-date) lives in the cached posting's YAML front-matter and is
   parsed per JD in the loop.

## Eligible set + optional limit

**Default: score every eligible record.** "Eligible" = queued openings
minus URLs already in `data/reviews.jsonl`. Filter already triaged the
queue; capping again is opt-in, not default.

Parse `$ARGUMENTS`:
- `--limit N` → score only the first N eligible records (preview /
  budget control). The first N is file-order from the openings JSONL,
  not quality-ranked.
- No arg → score every eligible record.

If the eligible set is empty, print
`nothing new to review — every queued URL is already in data/reviews.jsonl.`
and STOP.

If eligible set > 30, print one line before scoring so the user knows
it'll be a longer run:
`about to score N openings — use --limit M if you want to cap.`

If `--limit N` was passed and N < eligible set size, score the first N
records and mention the shortfall in the summary
(`scored N of M eligible — re-run to continue`).

## Per-JD loop

For each eligible record:

### 1. Read the posting

Open `posting_path`. The file has a YAML front-matter block at top
(between `---` markers) containing `url`, `fetched`, `title`,
`company`, `location`, and optionally `seniority`, `salary`, `posted`.
The verbatim JD body follows the closing `---`.

Parse the front-matter into local variables for this JD: `title`,
`company`, `location`, `posted`. Use the body for content-driven
scoring (domain_fit, tech_overlap, role_quality, soft-flag phrase matches).

If the file is missing (cache was wiped), log
`warn: posting missing for <url> — skipped.` and continue to the next
record. If the front-matter is malformed or missing required fields,
derive what you can from the body and add `posting_metadata_recovered`
to `soft_flags` (defined in the Soft flags section below).

Note: front-matter `posted` may be relative ("3 weeks ago", "21h ago",
"yesterday") — preserve it verbatim in the JSON output's `posted`
field. Survey's filter already handled staleness; review doesn't re-check.

### 2. Score it

Scoring is two-stage. First check the **gates** (binary). If any
gate fails, the JD is `skip` — no score number needed, regardless of
how strong the fit looks. Otherwise compute the weighted **fit
score** across three criteria.

#### Stage A — Gates (binary, body-level)

Filter already drops the obvious metadata-level cases. These gates
re-check at the body level — defense in depth. `region` and
`seniority` can catch metadata-lied-or-incomplete cases (body says
"must be located in NYC" though `listing.location` said "Remote").
`work_auth`, `deal_breakers`, and `compensation` are body-only —
filter never sees them.

| Gate | Passes if |
|---|---|
| `region` | JD location/policy overlaps `criteria.target.acceptable_timezones` OR matches a remote-anywhere phrase (worldwide, fully remote, work from anywhere) |
| `seniority` | JD level is within ±1 of `criteria.target.level` (Senior accepts Senior / Staff / Lead; Lead accepts Senior / Lead / Staff / Principal) |
| `work_auth` | JD does NOT require work auth candidate lacks (cross-check `profile.candidate.work_authorized_in`) |
| `deal_breakers` | NO `criteria.deal_breakers` term appears in JD title or body |
| `compensation` | NOT equity-only / unpaid / "we'll pay you in equity" |

For each failed gate, add the gate's name to `gates_failed`. If
`gates_failed` is non-empty: set `score = null`, `subscores = null`,
`recommendation = "skip"`, write a `reasoning` that names the failed
gate(s), and skip the fit-score stage.

#### Stage B — Fit score (only for gate-passers)

**Weights** (sum to 1.0):
- `domain_fit`: 0.50 — substance overlap with the target domain
  (`criteria.target` + `criteria.keywords.positive`).
- `tech_overlap`: 0.30 — how many `profile.tech_stack` terms
  (flattened across categories) appear in the JD body. Record the
  matching terms in `matched_tech`.
- `role_quality`: 0.20 — concrete scope, ownership signals, team /
  org described, comp visibility.

**Per-criterion anchors:**

| criterion | high (80-100) | medium (50-79) | low (0-49) |
|---|---|---|---|
| `domain_fit` | Squarely in target domain — multiple `keywords.positive` terms in title + body | Adjacent — applied target work in a non-target context, or one-off mentions | Generic or off-domain |
| `tech_overlap` | ≥3 distinct `profile.tech_stack` terms in JD body | 1-2 stack terms OR adjacent tools in the same family | Generic stack only (Python, PyTorch, AWS) with no domain-specific tooling |
| `role_quality` | Concrete scope (named systems / products / metrics), ownership wording ("own", "drive", "design from scratch"), team or org described, comp disclosed | Decent scope, some ownership wording, mostly clear responsibilities | Vague scope; "rockstar" / "ninja" / "passionate" / "fast-paced" without substance; no comp |

**Weighted total**: `score = 0.50 × domain_fit + 0.30 × tech_overlap + 0.20 × role_quality`

#### Soft flags (informational, do NOT change recommendation)

Body signals worth surfacing in the dashboard but not gate-level
disqualifiers. List any that fire in `soft_flags`:

- `vague_scope` — buzzword-heavy ("rockstar", "ninja", "passionate",
  "fast-paced") without substance.
- `crunch_signals` — "wear many hats", "scrappy", "move fast" paired
  with vague scope.
- `posting_metadata_recovered` — front-matter was malformed; treat
  scoring as lower-confidence.

#### Recommendation rules

- `gates_failed.length > 0` → `skip`
- `score >= 70` → `apply`
- `score < 70` → `research` (still gate-passed; the score number tells
  you how weak the fit is)

### 3. Build the JSON record (and stash for end-of-loop write)

Build one JSON object per JD on a **single line** (no internal
newlines, no indented `JSON.stringify` — JSONL parser depends on it).
Collect the new lines in context as you go; you'll write them all in
one operation after the loop finishes. Two concrete shapes:

**Gate-passer** (all gates passed, populated score):

```json
{"url":"https://example.com/job/senior-voice-ai","posting_path":"data/postings/26c15c6d3c757288ff768b6ad771cb03c03be72f.md","reviewed_at":"2026-05-11","title":"Senior Voice AI Engineer","company":"Acme Voice","location":"Remote (Worldwide)","posted":"3 weeks ago","gates_failed":[],"score":83,"subscores":{"domain_fit":90,"tech_overlap":80,"role_quality":70},"recommendation":"apply","reasoning":"Squarely in target domain — LiveKit, Whisper, TTS pipelines explicitly mentioned. Concrete scope (50ms latency target) and ownership wording. Comp not disclosed.","matched_tech":["LiveKit","Whisper","VAD"],"soft_flags":[]}
```

**Gate-failed** (one or more gates failed, score and subscores null):

```json
{"url":"https://example.com/job/region-locked","posting_path":"data/postings/abc123.md","reviewed_at":"2026-05-11","title":"Senior ML Engineer","company":"Examplecorp","location":"San Francisco, CA","posted":"5 days ago","gates_failed":["region","work_auth"],"score":null,"subscores":null,"recommendation":"skip","reasoning":"Region-locked to SF Bay (outside acceptable timezones) and requires US work authorization.","matched_tech":[],"soft_flags":[]}
```

**Field constraints:**
- `score`, each `subscores.*`: integer 0-100, or `null` if any gate failed.
- `subscores`: the full 3-criterion object, or `null` if any gate failed.
- `gates_failed`: `[]` if all gates passed; otherwise array of gate names.
- `reasoning`: 2-4 sentences for scored JDs; 1 sentence naming the failed gate(s) for skipped JDs.
- `reviewed_at`: ISO 8601 date `YYYY-MM-DD` (the env's "Today's date" — day-level granularity is enough).
- `matched_tech`: empty array `[]` for gate-failed JDs.

## Write the ledger (once, after the per-JD loop completes)

Update `data/reviews.jsonl` via the `Write` tool (not Bash):

1. Use the existing-content string captured in preflight (empty if the
   file didn't exist).
2. Strip its trailing whitespace.
3. Concatenate: existing content + `\n` (if existing was non-empty)
   + your new JSONL lines joined by `\n` + a final `\n`.
4. One `Write` call to `data/reviews.jsonl` with the combined string.

## Summary

After processing all eligible records, print a tight top-by-score
view. Show top 5, or all if fewer than 5 were scored:

```
**Reviewed N** — top by score:

  1. <score>  <Company> — <Title>  [<recommendation>]
     <one-line reasoning>
     <url>
  2. ...

**Open dashboard**: `npm run dashboard`
```

If `data/reviews.jsonl` has ≥5 total records, also print a lifetime
distribution after the top-5:

```
Lifetime (<N> reviews tracked):
  ≥90:   <count>
  75-89: <count>
  55-74: <count>
  <55:   <count>
```

## Optional: trigger advise

If `data/reviews.jsonl` has > 20 total records AND no
`reports/advice/YYYY-MM-DD.md` exists for today, suggest at the very
end of the summary:

> You now have N reviews on record — consider running `/argopia-advise`
> for CV-vs-market guidance.

## Token discipline

- One `Read` per JD (the posting). Never re-fetch from the network —
  postings are cached on disk at `posting_path`.
- One `Read` + one `Write` of `data/reviews.jsonl` per run (at
  preflight and end-of-loop). No Bash for file I/O.
- No per-JD prose to the user. Only the final summary is verbose.
