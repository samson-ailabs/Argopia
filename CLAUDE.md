# Argopia — Claude Context

Job-search bot for Claude Code. Two-stage pipeline: deterministic Node
filter → in-context Claude scoring. **README.md targets human users;
this file targets me.**

User-layer vs system-layer file ownership is documented in
`DATA_CONTRACT.md`. Every edit decision should respect that boundary.

## Stack

- Node 20+ — two npm deps: `js-yaml` (parse YAML), `ajv` (JSON Schema validation)
- Playwright MCP (when present in the user's Claude Code session) for
  SPA-rendered job sources
- No API keys, no Anthropic SDK — eval runs in the user's existing
  Claude Code session at whatever model is configured

## Where to read first

| Question | Authoritative source |
|---|---|
| "What's the contract for X?" | `schemas/<X>.schema.yaml` |
| "What does populated X look like?" | `templates/default/<X>.yaml` |
| "How does X get filled or used?" | `.claude/commands/argopia-<verb>.md` |
| "What does the user see?" | `README.md` |
| "What's the rubric?" | `.claude/commands/argopia-eval.md` (inlined) |
| "What conventions apply?" | The `Conventions:` block at the top of each schema |
| "Is this file user-owned or system-owned?" | `DATA_CONTRACT.md` |
| "What's planned next?" | GitHub Issues / Discussions |

## The two-stage model — load-bearing contract

| Stage | Who | Does | Cost |
|---|---|---|---|
| 1 — Aggregate + filter | Node | fetch JSONL, regex/substring match, dedup | $0 |
| 2 — Score JDs | Claude | read profile + criteria + JD, apply rubric | tokens |

**Claude reasons. Node enforces fixed logic.** When unsure where
something belongs:

- Pure regex / substring / arithmetic / file ops → Node script
- Reading PDF, extracting structure, judging fit, narrating → Claude
  (slash command body)

## File layout

```
.claude-plugin/      plugin manifest (commands/agents/MCP discovery)
.claude/commands/    user-facing slash commands (entry surface)
agents/              reusable subagent prompts (profile-extractor, criteria-deriver, playwright-fetcher)
schemas/             3 validation contracts (profile, criteria, sources)
templates/<domain>/  starter library; `default` is the shipped domain-agnostic scaffold
scripts/             single-file Node helpers (.mjs)
working/             3 user-editable files after /argopia-onboard (gitignored)
data/                runtime state — seen.jsonl, queue/, raw/, active-domain.txt
reports/             per-JD markdown + tracker.md + insights/
archives/            prior working/ snapshots from re-onboarding
```

## `working/` contract — exactly 3 files

| File | Role |
|---|---|
| `profile.yaml` | **Identity** — who I am, what I've built, what I know |
| `criteria.yaml` | **Preferences** — what I want / won't accept; Stage-1 keyword rules |
| `sources.yaml` | **Where to look** — one entry per board (all fetched via Playwright MCP) |

The Stage-2 scoring **rubric is inlined in
`.claude/commands/argopia-eval.md`** — not a separate YAML.

## Slash commands (workflow order)

1. `/argopia-onboard <cv-path>` — parse CV, copy template to `working/`,
   derive `profile.yaml` + parts of `criteria.yaml` from CV
2. *(user manually reviews `working/*.yaml`)*
3. `/argopia-verify` — schema check + source shape check + filter
   sanity → writes `working/.verified`
4. `/argopia-scan [<url> ...]` — spawns Playwright subagents per
   enabled source; filters; dedupes; writes queue. With URL args:
   inject directly into queue (Mode B)
5. `/argopia-eval [--top N | --all]` — for each queued URL: fetch JD,
   score against profile + criteria via inlined rubric, write report +
   tracker row
6. `/argopia-insights` — on demand; aggregate tracker → market-vs-CV
   gap report
7. `/argopia-status` — pipeline state at a glance
Environment setup runs automatically on `npm install` via
`scripts/install.mjs` (npm `postinstall`); no slash command for it.

`/argopia-scan` **refuses** if `.verified` is missing or older than any
`working/*.yaml`. Edit working/ → re-verify before scanning.

## Scripts (Node, deterministic)

| Script | Reads | Writes |
|---|---|---|
| `filter.mjs` | `working/criteria.yaml` + stdin JSONL | stdout filtered JSONL |
| `dedup.mjs` | `data/seen.jsonl` + stdin JSONL | stdout new URLs only |
| `verify.mjs` | `working/*` + `schemas/*` | `working/.verified` |
| `onboard.mjs` | `templates/<domain>/` | `working/`, `archives/`, `data/active-domain.txt` |
| `install.mjs` | (none) | runtime dirs (`working/`, `data/`, `reports/`, `archives/`); env check. Auto-runs on `npm install` via `postinstall`. |
| `status.mjs` | `data/`, `reports/tracker.md` | stdout summary |
| `lib/schema.mjs` | (library) | YAML shape validator |

## Two-stage filter pipeline

### Stage 1 — title-only triage (cheap, deterministic)

Operates on `{ url, title }` from the scan agent. Listing-body fields
(company, location, posted_at, description) are empty at scan time,
so gates needing them auto-no-op and migrate to Stage 2.

| Gate | Source | Behavior |
|---|---|---|
| Sub-target seniority | auto-derived from `target.level` | drops {junior, intern, trainee, entry-level, ...} matches against title |
| `keywords.negative` | criteria.yaml | vocabulary-collision drops (title only) |
| Positive required | criteria.yaml `keywords.positive` | at least one of: `job_titles`, `title_token_sets` (AND of tokens, separator-agnostic), `technical`, `tools` matches the title |

`excluded_companies`, `max_listing_age_days`, region lock — all
no-op at Stage 1 (no company/location/date in URL-only flow); they
become red-flag caps at Stage 2.

### Stage 2 — JD-aware judgment (full-body fetch, expensive)

For each Stage-1 survivor, `/argopia-eval` fetches the JD body and
evaluates against the rubric in `argopia-eval.md`. Hard gates that
moved here from Stage 1 (excluded company, region lock, staleness) cap
the recommendation at "skip" regardless of rubric score.

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
- **Don't add direct-mode adapter scripts.** Every source is fetched via
  Playwright MCP. We dropped per-site Node adapters in favor of a single
  navigation flow.
- **Don't break the 3-file `working/` contract.** New runtime config
  goes in `schemas/` (validation) or `templates/<domain>/` (defaults).
- **Don't fabricate CV facts.** Missing field → `null`. Empty list-type
  section → `[]`. Don't infer `employment_type: full-time` unless the
  CV explicitly says so.
- **Don't skip the `.verified` gate.** Every `working/` edit
  invalidates it; re-run `/argopia-verify` before `/argopia-scan`.
- **Don't add comments that restate the field name** or duplicate the
  schema's Conventions block. A field gets an inline comment only if
  the field name + type is insufficient (enum values, format quirks,
  null semantics, when-to-fill guidance, disambiguation).
