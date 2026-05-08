# Argopia — Claude Context

Job-search bot for Claude Code. Two-stage pipeline: deterministic Node
filter → in-context Claude scoring. **README.md targets human users;
this file targets me.**

User-layer vs system-layer file ownership is documented in
`DATA_CONTRACT.md`. Every edit decision should respect that boundary.

## Stack

- Node 20+ — two npm deps: `js-yaml` (parse YAML), `ajv` (JSON Schema validation)
- No API keys, no Anthropic SDK — eval runs in the user's existing
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
| "What's the rubric?" | `.claude/commands/argopia-eval.md` (inlined) |
| "What conventions apply?" | The `Conventions:` block at the top of each schema |
| "Is this file user-owned or system-owned?" | `DATA_CONTRACT.md` |
| "What's planned next?" | GitHub Issues / Discussions |

## The two-stage model — load-bearing contract

| Stage | Who | Does | Optimizes for | Cost |
|---|---|---|---|---|
| 1 — Aggregate | Node + WebFetch | source pre-filter via URL params (`criteria.target.*`), fetch listings, dedup against seen.jsonl | **recall** | $0 |
| 2 — Judge | Claude | fetch JD body, apply keyword filter (body-aware) + rubric, write report, mark seen | **precision** | tokens |

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
data/                runtime state — seen.jsonl, queue/, raw/
reports/             per-JD markdown + tracker.md + insights/
```

## `working/` contract — exactly 3 files

| File | Role |
|---|---|
| `profile.yaml` | **Identity** — who I am, what I've built, what I know |
| `criteria.yaml` | **Preferences** — what I want / won't accept; Stage-1 keyword rules |
| `sources.yaml` | **Where to look** — one entry per board, dispatched by `type` (api / html / browser) |

The Stage-2 scoring **rubric is inlined in
`.claude/commands/argopia-eval.md`** — not a separate YAML.

## Slash commands (workflow order)

1. `/argopia-onboard <cv-path>` — parse CV, copy template to `working/`,
   derive `profile.yaml` + parts of `criteria.yaml` from CV
2. *(user manually reviews `working/*.yaml`)*
3. `/argopia-scan [<url> ...]` — for each enabled source, construct
   pre-filter URL from `criteria.target.*`, dispatch by `type` (api →
   Node fetch, html → WebFetch, browser → browser-MCP subagent), dedupe
   read-only against `seen.jsonl`, write queue. With URL args: inject
   directly into queue (Mode B).
4. `/argopia-eval [--top N | --all]` — for each queued URL: fetch JD,
   score against profile + criteria via inlined rubric, write report +
   tracker row.
5. `/argopia-insights` — on demand; aggregate tracker → market-vs-CV
   gap report.
6. `/argopia-status` — pipeline state at a glance.

Environment setup runs automatically on `npm install` via
`scripts/install.mjs` (npm `postinstall`); no slash command for it.

## Scripts (Node, deterministic)

| Script | Reads | Writes | Used by |
|---|---|---|---|
| `fetch.mjs` | `working/sources.yaml` entry, source URL (JSON for type=api) | `data/raw/<ts>-<name>.jsonl` | scan |
| `dedup.mjs` | `data/seen.jsonl` + stdin JSONL (read-only — does NOT write to seen.jsonl) | stdout new URLs only | scan |
| `filter.mjs` | `working/criteria.yaml` + stdin JSONL | stdout filtered JSONL | eval |
| `onboard.mjs` | `templates/` | `working/` | onboard |
| `install.mjs` | (none) | runtime dirs (`working/`, `data/`, `reports/`); env check. Auto-runs on `npm install` via `postinstall`. | npm postinstall |
| `status.mjs` | `data/`, `reports/tracker.md` | stdout summary | status |
| `lib/schema.mjs` | (library) | YAML shape validator | scan/onboard |

## Two-stage filter pipeline

### Stage 1 — Aggregate (scan, recall-first)

`/argopia-scan` casts a wide net using **source pre-filter via URL
params**: read `criteria.target.*` (`search_queries`, `remote_only`,
`level`, `max_listing_age_days`) and append them per each source's
`filter_hints` URL syntax. Each entry in `search_queries` triggers a
separate fetch pass per source. The source's own server-side filter
does the coarse work.

Then dedup the fetched URLs against `data/seen.jsonl` (read-only — scan
doesn't write to seen). Output: `data/queue/<ts>.txt`.

No keyword filter at this stage. Title-only filtering would drop
listings whose relevance lives in the body. Cost: $0 (just orchestration).

### Stage 2 — Judge (eval, precision-first)

`/argopia-eval` reads each queued URL, fetches the JD body, and:

1. Applies the **keyword filter** (`scripts/filter.mjs`) against
   title + body. Gates:

| Gate | Source | Behavior |
|---|---|---|
| Sub-target seniority | auto-derived from `target.level` | drops {junior, intern, trainee, entry-level, ...} matches against title |
| `keywords.negative` | criteria.yaml | vocabulary-collision drops (full haystack — title + body) |
| Positive required | criteria.yaml `keywords.positive` | at least one of: `job_titles`, `title_token_sets` (AND of tokens), `technical`, `tools` matches |
| `excluded_companies` | criteria.yaml `target` | runs against company field if present in body |
| `max_listing_age_days` | criteria.yaml `target` | runs against posted-date in body |
| Region lock | criteria.yaml `target.{preferred,acceptable}_timezones` | runs against location in body |

2. If the filter rejects → write a minimal "skipped: <reason>" report,
   mark URL as seen. **No rubric tokens spent.**

3. If the filter passes → apply the rubric, write a full report,
   mark URL as seen with score.

Filter is body-aware here because the body is fetched anyway for
rubric. Filter cost is $0 once body is fetched. The filter rejection
path saves rubric tokens for the obvious mismatches.

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
- **Don't reference Stage 2 behavior in profile / sources schema
  comments.** File-scope only. The rubric / scoring / "model normalizes
  X" lives in `argopia-eval.md`, not in profile schema.
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
