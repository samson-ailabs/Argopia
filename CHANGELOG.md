# Changelog

All notable changes to Argopia are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-15

First release. CV-driven job-search bot for Claude Code: drop in a CV,
get scored job leads from public boards. No API keys, runs locally.

### Added

- **`/argopia-onboard <cv-path>`** — parse a CV into a starter
  `working/` (profile + CV-derived criteria + verified sources catalog).
- **`/argopia-survey`** — type-dispatched source discovery (api via
  `scripts/fetch.mjs`, html via the `source-surveyor` sub-agent),
  chunked JD-posting fetch via the `posting-fetcher` sub-agent, 6-gate
  keyword + region + staleness filter, openings queue.
- **`/argopia-review`** — score the queue against `profile + criteria`
  using a two-stage rubric (binary gates → 3-criterion fit score) and
  append one JSON line per opening to `data/reviews.jsonl` (the
  canonical review ledger). Gate failures (region, seniority,
  work_auth, deal_breakers, compensation) produce `skip` without a
  score; gate-passers are ranked by `domain_fit / tech_overlap /
  role_quality`.
- **`/argopia-advise`** — aggregate `reviews.jsonl` (and sampled
  posting bodies) into a decision-support report: up to 3 recommended
  actions for the week (CV rewrite / criteria tweak / source-mix
  tweak), longer-horizon patterns to watch, evidence backing
  (positioning rewrites, market terms missing, pipeline health,
  criteria signals), and a state-anchored re-run threshold.
- **`npm run dashboard`** — render `reports/dashboard.html`, a
  self-contained sortable/filterable view of every review with an
  expandable deep-dive panel and in-browser triage marks
  (apply / skip / save) persisted to localStorage.
- **Incremental re-runs** — sha1-keyed posting cache
  (`data/postings/<sha>.md`) plus the `data/reviews.jsonl` ledger
  together skip URLs already fetched or scored. Re-runs cost only
  what's new since last time.
- **Schema-validated `working/` contract** —
  `schemas/{profile,criteria,sources}.schema.yaml` define the
  user-editable surface; `templates/` ships starter shapes copied in
  on first onboarding.
- **Zero-config install** — `npm install` runs `scripts/install.mjs`
  via npm postinstall to create runtime dirs and verify environment.
  No manual setup steps.

### Scope notes

- Browser-MCP source type is declared in the schema but disabled in
  v0.1 — auth-walled and SPA-only boards await later releases.
- Single-domain by design. Multi-domain template scaffolding is
  deferred until v0.1 has been used on a real CV end-to-end.
