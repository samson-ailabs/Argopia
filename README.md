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

> *Argos Panoptes — the hundred-eyed watcher of Greek myth — guarded what
> mattered. Never sleeping, never blinking, every eye on a different
> horizon. **Argopia** is the same idea, narrower: many eyes on many
> job boards, watching for the role you actually want, while you do
> something else.*

---

## What it does

Scanning the same handful of job boards week after week — sifting through
repetitive listings for the handful that actually fit — is the kind of
low-signal work that bleeds time and quietly stops happening when life
gets busy.

Argopia runs that loop for you. It derives filter rules from your CV,
surveys public boards, scores every survivor against your profile with
a transparent rubric, surfaces matches in a local dashboard, and
reflects back on what the market wants vs. what your CV shows as more
reviews land. Your hour goes into the application, not the search.

```
$ /argopia-onboard ./my-cv.pdf
✓ Onboarded with the default template
Profile (extracted from your CV): who you are, what you've built, what you know
Criteria (derived from your profile): what you want, what you won't accept

$ /argopia-survey
✓ 8 sources, 47 listings → 12 queued after filter

$ /argopia-review
✓ 12 scored — 2 apply (≥70), 8 research, 2 skip

$ npm run dashboard
→ http://localhost:4242
```

<div align="center">

<video src="docs/dashboard.mp4" controls muted loop autoplay playsinline width="90%">
  <a href="docs/dashboard.mp4">Watch the 38-second dashboard demo</a>
</video>

</div>

## How it works

Two stages, two cost profiles.

1. **Survey** runs in deterministic Node — fetches listings from
   public boards, drops 70-90% via keyword + region + staleness
   filters, and caches the survivors as content-addressed posting
   files. Cheap, predictable, no tokens spent.
2. **Review** then runs inside your existing Claude Code session —
   reads each cached posting, scores it against your CV with a
   two-stage rubric (binary gates → 3-criterion fit score), and
   appends one JSON line per opening to `data/reviews.jsonl`. This is
   where Claude spends — only on what the filter let through.

The dashboard renders that ledger; `/argopia-advise` reflects on it
to suggest CV, criteria, or source edits.

Re-runs cost only what's new since last time.

## Principles

- **CV is the spine.** Every config — keywords, deal-breakers, target
  levels, excluded companies — is derived from your CV, not the other
  way around.
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

Then inside Claude Code:

```
/argopia-onboard ./your-cv.pdf
```

From there: `/argopia-survey` → `/argopia-review` → `npm run dashboard`.
See [The pipeline](#the-pipeline) below for what each command does.

## The pipeline

| Command                       | What it does                                                                                       |
|-------------------------------|----------------------------------------------------------------------------------------------------|
| `/argopia-onboard <cv>`       | Parse CV → populate `working/profile.yaml` and `criteria.yaml`                                     |
| `/argopia-survey`             | Discover URLs from enabled sources, fetch + cache JD postings, filter, queue openings              |
| `/argopia-review [--limit N]` | Score each queued opening against your CV; append one JSON line per opening to `data/reviews.jsonl`|
| `/argopia-advise`             | Reflect on `reviews.jsonl` → recommended edits, longer-horizon patterns, and evidence backing      |
| `npm run dashboard`           | Build `reports/dashboard.html` — sortable, filterable triage view of every review                  |

## Configuration

Three files in `working/`, three matching files in `templates/`. Each owns one concern:

| File             | Role                                              | Filled by                    |
|------------------|---------------------------------------------------|------------------------------|
| `profile.yaml`   | Identity — who you are, what you've built         | profile-extractor, then you  |
| `criteria.yaml`  | Preferences — what you want / won't accept        | criteria-deriver, then you   |
| `sources.yaml`   | Where to look — one entry per board               | Argopia defaults, then you   |

The scoring rubric lives **inside** `/argopia-review` — not as a
separate file the user maintains.

**Customizing.** `templates/` ships starter scaffolds for your tech /
role / region. Edit them *before* running `/argopia-onboard`, or edit
the copies in `working/` *after* onboarding. No code changes
required — if you find yourself reaching into `scripts/`, that's a
bug; open an issue.

**Updates are safe.** `working/`, `data/`, `reports/` are gitignored —
your personal state stays put. `git pull` only updates Argopia's code
(templates, schemas, scripts, slash commands, agents).

## Roadmap

**v0.1 (current — public alpha).** Full pipeline works end-to-end:
onboarding, the curated api + html boards in `templates/sources.yaml`,
the scoring rubric, the dashboard, and on-demand advise.

**Next up**, roughly in order:

1. **SPA boards** via browser MCP (Indeed, Glassdoor, etc.) — JS-rendered listings, no auth needed.
2. **Auth-walled boards** (LinkedIn, etc.) — login + session management on top of browser MCP.
3. **Domain templates beyond speech-AI** — frontend, backend, ML research, data engineering

**Speculative / depends on demand**:

- Multi-CLI support (Gemini CLI, OpenCode, Qwen)

## Contributing

Code contributions welcome. The [issue tracker](https://github.com/samson-ailabs/argopia/issues)
holds bugs and feature requests; starter-friendly ones are tagged
[`good first issue`](https://github.com/samson-ailabs/argopia/labels/good%20first%20issue).
Two especially-welcome paths:

- **Add a board** to `templates/sources.yaml` (api or html; SPA / auth
  boards await browser-MCP support).
- **Add a domain template** if your tech stack isn't speech-AI — the
  three `working/` files plus a starter rubric is all that's needed.

For larger work, open an issue first so we can sanity-check the scope.

## Sponsor

I built Argopia for my own job search. If it saves you hours too,
[sponsoring on GitHub](https://github.com/sponsors/samson-ailabs)
returns some of that value and accelerates the roadmap above —
more boards, more templates, faster issue triage.

## License

[MIT](LICENSE) — use, fork, modify freely. Attribution appreciated.
