# Argopia — Claude Context

Job-search bot for Claude Code. Two-stage pipeline: deterministic Node
filter → in-context Claude scoring. **README.md targets human users;
this file targets me.**

User-layer vs system-layer file ownership is documented in
`DATA_CONTRACT.md`. Every edit decision should respect that boundary.

## Stack

- Node 20+ — two npm deps: `js-yaml` (parse YAML), `ajv` (JSON Schema validation)
- No API keys, no Anthropic SDK — assay runs in the user's existing
  Claude Code session at whatever model is configured
- No MCP browser dependency for v0.1. SPA-rendered and auth-walled boards
  are shipped disabled in `sources.yaml` until browser-MCP support lands.

## Where to read first

| Question | Authoritative source |
|---|---|
| "What's the contract for X?" | `schemas/<X>.schema.yaml` |
| "What does populated X look like?" | `templates/<X>.yaml` |
| "How does X get filled or used?" | `.claude/commands/argopia-<verb>.md` |
| "What does the user see?" | `README.md` |
| "What's the rubric?" | `.claude/commands/argopia-assay.md` (inlined) |
| "What conventions apply?" | The `Conventions:` block at the top of each schema |
| "Is this file user-owned or system-owned?" | `DATA_CONTRACT.md` |
| "What's planned next?" | GitHub Issues / Discussions |

## The two-stage model — load-bearing contract

| Stage | Who | Does | Optimizes for | Cost |
|---|---|---|---|---|
| 1 — Scout | Node + WebFetch | source pre-filter, discover URLs, dedup vs `history.jsonl`, fetch JD postings (cached by URL hash), apply keyword filter, write openings | **recall** | listing fetches + posting fetches |
| 2 — Assay | Claude | read each opening's cached posting, apply rubric, write report, append to history | **precision** | rubric tokens |

**Claude reasons. Node enforces fixed logic.** When unsure where
something belongs:

- Pure regex / substring / arithmetic / file ops → Node script
- Reading PDF, extracting structure, judging fit, narrating → Claude
  (slash command body)

## File layout

```
.claude-plugin/      plugin manifest (commands/agents/MCP discovery)
.claude/commands/    user-facing slash commands (entry surface)
agents/              reusable subagent prompts (profile-extractor, criteria-deriver)
schemas/             3 validation contracts (profile, criteria, sources)
templates/           starter scaffolds copied to working/ during onboarding
scripts/             single-file Node helpers (.mjs)
working/             3 user-editable files after /argopia-onboard (gitignored)
data/                runtime state — history.jsonl, listings/, postings/, openings/
reports/             per-JD markdown + tracker.md + insights/
```

## `working/` contract — exactly 3 files

| File | Role |
|---|---|
| `profile.yaml` | **Identity** — who I am, what I've built, what I know |
| `criteria.yaml` | **Preferences** — what I want / won't accept; Stage-1 keyword rules |
| `sources.yaml` | **Where to look** — one entry per board, dispatched by `type` (api / html / browser) |

The scoring **rubric is inlined in
`.claude/commands/argopia-assay.md`** — not a separate YAML.

## Slash commands (workflow order)

1. `/argopia-onboard <cv-path>` — parse CV, copy template to `working/`,
   derive `profile.yaml` + parts of `criteria.yaml` from CV
2. *(user manually reviews `working/*.yaml`)*
3. `/argopia-scout [<url> ...]` — discover URLs (per enabled source,
   pre-filtered via URL params), dedup against `history.jsonl`, fetch JD
   postings into `data/postings/` (cached by URL hash), apply keyword
   filter, write `data/openings/<TS>.jsonl`. With URL args: skip
   discovery, run the same posting-fetch + filter pipeline on those
   URLs (Mode B).
4. `/argopia-assay [--top N | --all]` — for each queued opening:
   read posting from cache, apply the inlined rubric, write report +
   tracker row, append URL to `history.jsonl`.
5. `/argopia-insights` — on demand; aggregate tracker → market-vs-CV
   gap report.
6. `/argopia-status` — pipeline state at a glance.

Environment setup runs automatically on `npm install` via
`scripts/install.mjs` (npm `postinstall`); no slash command for it.

## Scripts (Node, deterministic)

| Script | Reads | Writes | Used by |
|---|---|---|---|
| `fetch.mjs` | `working/sources.yaml` entry, source URL (JSON for type=api) | `data/listings/<ts>-<name>.jsonl` | scout |
| `scout.mjs prepare <ts>` | stdin: raw JSONL; `data/history.jsonl`; `data/postings/` | stdout: unseen JSONL with posting_path + scouted_at; stderr: cache-miss report (JSON) | scout |
| `scout.mjs inject` | stdin: JSONL with posting_path; `data/postings/<sha>.md` | stdout: same JSONL with description = first 1.5K chars of cached body | scout |
| `scout.mjs finalize` | stdin: filter survivors JSONL | stdout: openings JSONL (description stripped) | scout |
| `filter.mjs` | `working/criteria.yaml` + stdin JSONL | stdout filtered JSONL | scout |
| `onboard.mjs` | `templates/` | `working/` | onboard |
| `install.mjs` | (none) | runtime dirs (`working/`, `data/`, `reports/`); env check. Auto-runs on `npm install` via `postinstall`. | npm postinstall |
| `status.mjs` | `data/`, `reports/tracker.md` | stdout summary | status |
| `lib/schema.mjs` | (library) | YAML shape validator | scout/onboard |

## Two-stage pipeline

### Stage 1 — Scout (recall-first)

`/argopia-scout` casts a wide net using **source pre-filter via URL
params**: read `criteria.target.*` (`search_queries`, `remote_only`,
`level`, `max_listing_age_days`) and append them per each source's
`filter_hints` URL syntax. Each entry in `search_queries` triggers a
separate fetch pass per source. The source's own server-side filter
does the coarse work.

The scout pipeline (one command, end-to-end):

1. **Discover** URLs from listing pages → `data/listings/<TS>-<source>.jsonl`.
2. **Prepare** (`scout.mjs prepare`): drop URLs already in
   `data/history.jsonl`, dedup within scout, compute `posting_path =
   data/postings/<sha1-of-url>.md` for each survivor, identify cache misses.
3. **Posting fetch**: for each cache-miss URL, WebFetch the JD posting
   and write to `data/postings/<sha1>.md` (one provenance comment +
   markdown content). Cache hits skip this step entirely.
4. **Filter** (`scout.mjs inject` → `filter.mjs` → `scout.mjs finalize`):
   inject posting content as `description`, run keyword gates, strip
   description from survivors. Survivors land in
   `data/openings/<TS>.jsonl`.

Filter gates (body-aware, since body is now in context):

| Gate | Source | Behavior |
|---|---|---|
| Sub-target seniority | auto-derived from `target.level` | drops {junior, intern, trainee, entry-level, ...} matches against title |
| `keywords.negative` | criteria.yaml | vocabulary-collision drops (full haystack — title + body) |
| Positive required | criteria.yaml `keywords.positive` | at least one of: `job_titles`, `title_token_sets` (AND of tokens), `technical`, `tools` matches |
| `excluded_companies` | criteria.yaml `target` | runs against company field if present in body |
| `max_listing_age_days` | criteria.yaml `target` | runs against posted-date in body |
| Region lock | criteria.yaml `target.{preferred,acceptable}_timezones` | runs against location in body |

Scout writes nothing to `history.jsonl` — that's assay's job. Re-running
scout with tweaked criteria re-evaluates filter rejects without
re-fetching postings (cache hits all the way through).

### Stage 2 — Assay (precision-first)

`/argopia-assay` reads the newest `data/openings/<TS>.jsonl`, drops
records whose URL already appears in `data/history.jsonl` (assay history
across runs), and processes the remaining set under `--top N` /
`--all` gating. For each:

1. Read the cached posting from `posting_path` (one disk read; no network).
2. Apply the rubric → 5 subscores + weighted total + recommendation.
3. Write the per-JD report and append a tracker row.
4. Append `{url, judged_at, score, recommendation}` to
   `data/history.jsonl` so the URL won't be re-scouted.

Posting cache + URL-keyed history ledger together mean scout and assay
are both idempotent and incrementally re-runnable.

## Non-obvious decisions (tribal knowledge)

- **Section order in `profile.yaml` = scoring weight, descending.**
  `tech_stack` sits right after `experience` (high `tech_overlap`
  signal); training and work-output follow; recognition (awards / certs
  / talks) later; community (volunteering) last.
- **`current_employer` is NOT a field.** Source of truth is
  `experience[0].employer`. Avoid duplicate-data drift.
- **`experience[].location` is NOT a field.** Employer location doesn't
  affect CV ↔ JD matching; the candidate's `location` does.
- **`experience[].tools` and `projects[].tech` are NOT fields.** Tools
  surface through `achievements` (narrative) and top-level `tech_stack`
  (aggregate). Three sources of truth was a bug magnet.
- **`work_authorized_in` is a single list**, not a 3-list dict.
  Citizenship + held visas combined; sponsorship-required is implied as
  the inverse.
- **`tech_stack` keys** use abbreviations for category labels (`asr`,
  `tts`, `llm`, `mlops`) and plural nouns for enumerable lists
  (`voice_agents`, `programming_languages`). Both conventions are
  correct — domain abbreviations don't pluralize cleanly.
- **Profile uses `programming_languages`, not `languages`.**
  `candidate.languages` is human languages (Vietnamese, English).
- **`kind` not `type`** for publication/talk classification — avoids
  visual collision with the schema's `type:` directive.
- **`achievements` not `bullets`** — names the meaning, not the render
  shape.
- **Title-vs-body matching is operational.** `positive.job_titles`
  matches title only; `positive.technical` / `tools` match title + body.
  The bucket distinction is real, not decorative.
- **Sub-target seniority is auto-derived, not hand-listed.** Don't add
  `intern` or `junior` to `keywords.negative` — `filter.mjs` derives
  the sub-target list from `target.level` automatically.
- **Negative keywords stay specific to vocabulary collisions.**
  Domain-collision phrases (voice actor, speech therapy, VoIP, sound
  design). Don't add things Stage 2 should handle (location, comp,
  spam quality).
- **Comments stay file-scope.** Profile schema comments don't reference
  rubric / scoring / consumption. Filters schema documents OR / AND-NOT
  matching semantics (write-time guidance) but not what stage runs the
  matcher. The principle: comments tell users what to write, not how
  data is later used.

## What NOT to do

- **Don't duplicate fields.** No `current_employer` while
  `experience[0].employer` exists; no per-role `tools` while
  `tech_stack` exists; no `narrative` blob while structured fields
  exist.
- **Don't reference assay behavior in profile / sources schema
  comments.** File-scope only. The rubric / scoring / "model normalizes
  X" lives in `argopia-assay.md`, not in profile schema.
- **Don't add per-site adapter scripts.** Source-specific behavior lives
  in `sources.yaml` config (selectors, patterns, field_map), dispatched by
  `type` (api / html / browser). Adding a `.mjs` per board would
  duplicate config that's already declarative.
- **Don't break the 3-file `working/` contract.** New runtime config
  goes in `schemas/` (validation) or `templates/` (defaults).
- **Don't fabricate CV facts.** Missing field → `null`. Empty list-type
  section → `[]`. Don't infer `employment_type: full-time` unless the
  CV explicitly says so.
- **Don't add comments that restate the field name** or duplicate the
  schema's Conventions block. A field gets an inline comment only if
  the field name + type is insufficient (enum values, format quirks,
  null semantics, when-to-fill guidance, disambiguation).
