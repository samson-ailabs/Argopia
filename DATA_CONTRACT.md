# Data Contract

**TL;DR:** `working/`, `data/`, `reports/` are yours forever.
Everything else is the system and may be updated.

Argopia separates files into two layers. **User-layer files are yours
forever.** **System-layer files are auto-updatable.** Updates (`git
pull`, future `argopia update`) will only touch the system layer.

## User Layer — never auto-updated

Your CV, your preferences, your scan history, your reports. Argopia
will never overwrite these.

| Path | Purpose |
|------|---------|
| `working/profile.yaml` | Your structured CV (after `/argopia-onboard`) |
| `working/criteria.yaml` | Your target preferences and keyword filters |
| `working/sources.yaml` | Which sources you've enabled / disabled |
| `working/.verified` | Your verification stamp (don't edit by hand) |
| `data/seen.jsonl` | URLs you've already encountered (dedup state) |
| `data/raw/*.jsonl` | Per-scan raw fetches |
| `data/queue/*.txt` | Per-scan filtered URL queues |
| `data/active-domain.txt` | Pointer to your active domain template |
| `reports/tracker.md` | Your central application tracker |
| `reports/<YYYY-MM-DD>/<slug>.md` | Per-JD evaluation reports |
| `reports/insights/<YYYY-MM-DD>.md` | On-demand market insights |
| Any local PDF or markdown CV files | Source documents you onboard from |

These are gitignored — they don't ship with the repo.

## System Layer — auto-updatable

Schema, templates, scripts, slash commands, framework docs. Updates
will replace these with newer versions.

| Path | Purpose |
|------|---------|
| `schemas/*.schema.yaml` | Validation contracts for `working/*.yaml` |
| `templates/<domain>/*.yaml` | Starter templates (`default` ships; add your own per-domain) |
| `scripts/*.mjs` and `scripts/lib/*.mjs` | Node helpers (filter, dedup, install, verify, status) |
| `.claude/commands/*.md` | Slash command definitions |
| `agents/*.md` | Reusable subagent prompts (e.g. playwright-fetcher) |
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.mcp.json` | MCP server declarations |
| `CLAUDE.md`, `README.md`, `DATA_CONTRACT.md` | Framework docs |
| `LICENSE` | Project license (MIT). `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` planned. |
| `package.json`, `package-lock.json` | Dependencies |
| `.github/FUNDING.yml` | GitHub Sponsors config. CI workflows + issue templates planned. |

## The customization rule

When you want to change Argopia's behavior for **your** job search
(your tech stack, your deal-breakers, your timezone, your preferred
sources), edit the user-layer files. Specifically:

- New positive/negative keywords → `working/criteria.yaml`
- New sources or disabled sources → `working/sources.yaml`
- CV updates → re-run `/argopia-onboard <new-cv>` (rewrites `working/profile.yaml`)
- Excluded companies, age cutoff → `working/criteria.yaml > target.*`

When you want to change Argopia's **default behavior for everyone**
(improving the default template, fixing a filter bug, adding a new
domain template), edit the system-layer files and submit a PR.

## What happens during an update

Today (v0.1.x): manual update via `git pull`. Because user-layer
directories are gitignored, a clean `git pull` will not overwrite your
data. If `git pull` reports a conflict on a system-layer file you've
edited locally, you've crossed the layer boundary — move your changes
to the appropriate user-layer file.

Future (v0.2.0+): `scripts/update-system.mjs` will fetch the latest
release, diff the system layer against your local copy, and apply
non-conflicting changes automatically.

## Templates as a special case

`templates/<domain>/*.yaml` is system layer. The customization workflow
is:

```
templates/<domain>/      → system (ships with Argopia, gets updated)
        ↓ (copied by /argopia-onboard)
working/                 → user (yours; updates never touch this)
```

If you customize `templates/default/criteria.yaml` directly, your
edits get clobbered on next update. Always edit `working/criteria.yaml`
instead.

The exception: if you're **contributing** an improvement to the
default template that should benefit everyone (e.g. better baseline
keyword coverage), edit `templates/default/criteria.yaml` and submit a
PR. Your local `working/` stays untouched either way.
