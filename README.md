<div align="center">

# Argopia

**Job-search automation for engineers, inside Claude Code.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)](.)
[![Built for Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-D97757)](https://docs.claude.com/en/docs/claude-code)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange)](.)
[![Sponsor](https://img.shields.io/github/sponsors/samson-ailabs?logo=github)](https://github.com/sponsors/samson-ailabs)

*Hand it your CV. It scans the boards, scores every opening against you, and shows its reasoning. Free, on your laptop, no API keys.*

</div>

<!-- TODO before public launch: add docs/dashboard.png and reference it here as a hero screenshot. The dashboard is the most show-not-tell artifact in this project. -->

> *Argos Panoptes — the hundred-eyed watcher of Greek myth — guarded what
> mattered. Never sleeping, never blinking, every eye on a different
> horizon. **Argopia** is the same idea, narrower: many eyes on many
> job boards, watching for the role you actually want, while you do
> something else.*

---

## What it does

Manually checking 40+ job boards a week is the kind of low-signal
repetitive work that bleeds time and quietly stops happening when life
gets busy.

Argopia onboards your CV, surveys public job boards for openings,
reviews each one against your profile, and advises you on CV
positioning and market gaps as the corpus grows — so you spend your
hour on the application itself, not the search.

```
$ /argopia-onboard ./my-cv.pdf
✓ Onboarded with the default template
Profile (extracted from your CV): candidate, experience, education...
Criteria (derived from your profile): search_queries, target.level, ...

$ /argopia-survey
$ /argopia-review
$ npm run dashboard          # open reports/dashboard.html in your browser
```

## How it works

Two stages, two cost profiles.

1. **Survey** runs in deterministic Node — fetches listings from
   public boards, drops 70-90% via keyword + region + staleness
   filters, and caches the survivors as content-addressed posting
   files. Cheap, predictable, no tokens spent.
2. **Review** then runs inside your existing Claude Code session —
   reads each cached posting, scores it against your CV with a
   two-stage rubric (binary gates → 3-criterion fit score), and
   appends one JSON line per opening to `data/reviews.jsonl`.

The dashboard renders that ledger; `/argopia-advise` reflects on it
to suggest CV / criteria / source-mix edits.

The expensive part (Claude scoring) only sees postings that already
passed the cheap filter. Re-runs skip what's on record. Re-running
survey costs ~zero for what you've already seen; re-running review
skips URLs already scored.

## Principles

- **CV is the spine.** Every config — keywords, deal-breakers, target
  levels, excluded companies — is derived from your CV, not the other
  way around.
- **Cheap by default.** Re-runs cost only what's new — the posting
  cache and review ledger together skip what's already on disk or
  already scored.
- **Free everything.** Public boards + your existing Claude Code session.
  No paid APIs, no Anthropic billing, no cloud storage.
- **Human ranks, you apply.** Argopia surfaces, scores, and explains;
  you decide whether to apply. No spray-and-pray.
- **Yours, not the bot's.** `working/` is your editable source of truth.
  Templates are starting material; you make them yours.

## Quick start

**Prerequisites**: Node 20+ and [Claude Code](https://docs.claude.com/en/docs/claude-code).

```bash
git clone https://github.com/samson-ailabs/argopia.git
cd argopia
npm install   # auto-runs scripts/install.mjs (env check + dir setup)
claude .      # open in Claude Code
```

Inside Claude Code:

```
/argopia-onboard ./your-cv.pdf
```

That's it. The onboard command guides you through review and the rest of the pipeline.

## The pipeline

| Command                    | What it does                                                                            | Runs as                |
|----------------------------|-----------------------------------------------------------------------------------------|------------------------|
| `/argopia-onboard <cv>`    | Parse CV → populate `working/profile.yaml` and `criteria.yaml`                          | Two subagents          |
| `/argopia-survey`          | Discover URLs from enabled sources, fetch JD postings (cached), filter, queue openings  | Type-dispatched: api + html direct fetch |
| `/argopia-review [--limit N]`| Read each opening's cached posting, score against CV, append one JSON line to `data/reviews.jsonl` | In-context Claude      |
| `/argopia-advise`          | Aggregate `reviews.jsonl` → CV positioning rewrites, market gaps, pipeline health, criteria signals | In-context Claude      |
| `npm run dashboard`        | Build `reports/dashboard.html` — sortable, filterable triage view of every review       | Local Node + browser   |

## Configuration

Three files in `working/`, three matching files in `templates/`. Each owns one concern:

| File             | Role                                              | Edited by                    |
|------------------|---------------------------------------------------|------------------------------|
| `profile.yaml`   | Identity — who you are, what you've built         | profile-extractor + you      |
| `criteria.yaml`  | Preferences — what you want / won't accept        | criteria-deriver + you       |
| `sources.yaml`   | Where to look — one entry per board               | Preset; you tune to taste    |

The scoring rubric lives **inside** `/argopia-review` — not as a
separate file the user maintains.

**Customizing.** `templates/` ships starter scaffolds for your tech /
role / region. Edit them *before* running `/argopia-onboard`, or edit
the copies in `working/` *after* onboarding. No code changes
required — if you find yourself reaching into `scripts/`, that's a
bug; open an issue.

**Yours vs ours.** `working/`, `data/`, `reports/` are gitignored —
yours forever. Templates, schemas, scripts, slash commands, and agents
are tracked and updated alongside the repo via `git pull`. Your
`working/` edits never get clobbered by updates.

## What's free / what's used

- **No paid sources.** All shipped boards are public.
- **No required API keys.** Just `npm install` and you're set.
- **No separate Anthropic billing.** Survey, review, and advise all run
  inside your existing Claude Code session.
- **Two npm deps.** `js-yaml` for parsing, `ajv` for JSON Schema validation.

## Roadmap

**v0.1 (current — public alpha)**: full pipeline (onboard → survey →
review → dashboard → advise) works end-to-end across the curated
api + html boards shipped in `templates/sources.yaml`.

**Next up**, roughly in order:

- SPA-rendered boards via browser MCP (Wellfound, Otta, etc.)
- Auth-walled boards via browser MCP (LinkedIn, YC Work at a Startup)
- Additional domain templates beyond speech-AI (frontend, backend,
  ML research, data engineering)
- Dashboard polish: saved searches, side-by-side opening comparison
- Multi-CLI support (Gemini CLI, OpenCode, Qwen)

PRs and issues welcome — see [`good first issue`](https://github.com/samson-ailabs/argopia/labels/good%20first%20issue)
for places to land a first contribution.

## Not in scope (by design)

These are deliberate non-goals, not roadmap items:

- **Apply for you** — Argopia ranks; you click apply. Always.
  Human-in-the-loop is the design.
- **Generate tailored CVs per JD** — a different problem with
  different trade-offs; not the same tool.
- **Replace your judgment** — every score has a reasoning string; the
  whole point is that *you* read it and decide.

## Contributing

Code contributions welcome. The [issue tracker](https://github.com/samson-ailabs/argopia/issues)
holds bugs, feature requests, and `good first issue` labels for help
opportunities. Two especially-welcome paths:

- **Add a board** to `templates/sources.yaml` (api or html; SPA / auth
  boards await browser-MCP support).
- **Add a domain template** if your tech stack isn't speech-AI — the
  three `working/` files plus a starter rubric is all that's needed.

For larger work, open an issue first so we can sanity-check the scope.

## Sponsor

Argopia is built and maintained solo, in spare time. If it saves you
hours of job-search drudgery, [sponsoring on GitHub](https://github.com/sponsors/samson-ailabs)
keeps the project active and accelerates the roadmap above. Even
$5/month makes a real difference — thank you.

## License

[MIT](LICENSE) — use, fork, modify freely. Attribution appreciated.
