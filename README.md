<div align="center">

# Argopia

**Job-search automation for engineers, inside Claude Code.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)](.)
[![Built for Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-D97757)](https://docs.claude.com/en/docs/claude-code)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange)](.)
[![Sponsor](https://img.shields.io/github/sponsors/samson-ailabs?logo=github)](https://github.com/sponsors/samson-ailabs)

*Hand it your CV. Get scored, ranked, deduplicated job leads — from public boards, on your laptop, free.*

</div>

> *Argos Panoptes — the hundred-eyed watcher of Greek myth — guarded what
> mattered. Never sleeping, never blinking, every eye on a different
> horizon. **Argopia** is the same idea, narrower: many eyes on many
> job boards, watching for the role you actually want, while you do
> something else.*

---

## What it does

Manually checking 40+ job boards a week is the kind of low-signal repetitive
work that bleeds time and quietly stops happening when life gets busy.
Argopia automates the mechanical part so you spend your hour on the
application itself, not the search.

```
$ /argopia-onboard ./my-cv.pdf
✓ Onboarded with the default template
Profile (extracted from your CV): candidate, experience, education...
Criteria (derived from your profile): search_queries, target.level, ...

$ /argopia-scan
$ /argopia-eval --top 10
```

## Principles

- **CV is the spine.** Every config — keywords, deal-breakers, target
  levels, excluded companies — is derived from your CV, not the other
  way around.
- **Cheap by default.** Stage 1 is deterministic Node (regex, dedup) that
  drops 70-90% of listings before Claude ever sees them.
- **Free everything.** Public boards + your existing Claude Code session.
  No paid APIs, no Anthropic billing, no cloud storage.
- **Validates before it runs.** `/argopia-scan` rejects malformed
  config upfront — bad setups never burn tokens.
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

| Command                   | What it does                                                  | Runs as                |
|---------------------------|---------------------------------------------------------------|------------------------|
| `/argopia-onboard <cv>`   | Parse CV → populate `working/profile.yaml` and `criteria.yaml`| Two subagents          |
| `/argopia-scan`           | Validate config, fetch enabled sources, filter, dedup, queue  | Type-dispatched: api/html direct, browser-MCP for SPA |
| `/argopia-eval [--top N]` | Fetch JD bodies, score against CV, write per-JD reports       | In-context Claude      |
| `/argopia-insights`       | Aggregate tracker → market-vs-CV gap report (on demand)       | In-context Claude      |
| `/argopia-status`         | Pipeline state at a glance + suggested next command           | Node script            |

## Configuration

Three files in `working/`, three matching files in `templates/`. Each owns one concern:

| File             | Role                                              | Edited by                    |
|------------------|---------------------------------------------------|------------------------------|
| `profile.yaml`   | Identity — who you are, what you've built         | profile-extractor + you      |
| `criteria.yaml`  | Preferences — what you want / won't accept        | criteria-deriver + you       |
| `sources.yaml`   | Where to look — one entry per board               | Preset; you tune to taste    |

The Stage-2 scoring rubric lives **inside** `/argopia-eval` — not as a
separate file the user maintains.

## Customizing the template

The three files in `templates/` are starter scaffolds. Edit them for
your tech / role / region preferences before running `/argopia-onboard`,
or edit the copies in `working/` after onboarding (your `working/`
edits are gitignored and never overwritten by updates).

No code changes required. If you find yourself reaching into `scripts/`
to customize, that's a bug — open an issue.

## What's free / what's used

- **No paid sources.** All shipped boards are public.
- **No required API keys.** Just `npm install` and you're set.
- **No separate Anthropic billing.** Eval and insights run inside your
  existing Claude Code session.
- **Two npm deps.** `js-yaml` for parsing, `ajv` for JSON Schema validation.

## What's mine vs the system

`working/`, `data/`, `reports/` are gitignored — they're yours forever. Templates, schemas, scripts, and slash commands ship with the repo
and get updated. See [DATA_CONTRACT.md](DATA_CONTRACT.md) for the full
ownership table.

## Status & roadmap

**v0.1.0 — public alpha.** Onboarding flow, schemas, and the full
pipeline work end-to-end across the curated boards shipped in
`templates/sources.yaml`. Plugin packaging in place but not yet listed
on the Claude Code marketplace.

What's next: more board coverage (SPA-rendered + auth-walled boards via
browser MCP) and optional auto-update.

## What it doesn't do (yet)

- **Some boards aren't supported yet** — anything SPA-rendered (heavy
  anti-bot) or auth-walled ships disabled in `working/sources.yaml`.
  They re-enable as browser-MCP support lands.
- **Apply for you** — Argopia ranks; you click apply. Always.
  Human-in-the-loop is the design.
- **Generate tailored CVs** per JD — separate problem; not in scope for v0.x.
- **Multi-CLI** (Gemini CLI, OpenCode, Qwen, etc.) — Claude Code only for now.

## Sponsor

Argopia is built and maintained solo, in spare time. If it saves you hours of
job-search drudgery, [sponsoring on GitHub](https://github.com/sponsors/samson-ailabs)
keeps the project active and unlocks:

- More board coverage (SPA-rendered and auth-walled boards via browser MCP)
- Additional domain templates (frontend, backend, ML research, data engineering)
- Auto-updater (`scripts/update-system.mjs`)
- Faster issue triage and feature requests

Even $5/month makes a real difference — thank you.

## License

[MIT](LICENSE) — use, fork, modify freely. Attribution appreciated.
