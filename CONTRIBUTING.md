# Contributing to Argopia

Thanks for your interest. Contributions are welcome — bug fixes, new
boards, new domain templates, dashboard improvements.

## Before you start

- For anything beyond a small fix, [open an issue](https://github.com/samson-ailabs/argopia/issues)
  first so we can sanity-check the scope.
- Browse [`good first issue`](https://github.com/samson-ailabs/argopia/labels/good%20first%20issue)
  for starter-friendly tasks.

## Development setup

```bash
git clone https://github.com/samson-ailabs/argopia.git
cd argopia
npm install        # auto-runs scripts/install.mjs (env check + dir setup)
```

There's no build step — slash commands are Markdown, scripts are
single-file `.mjs`. Test by running the relevant `/argopia-*` command
in Claude Code, or by executing a script directly:

```bash
node scripts/fetch.mjs <args>
node scripts/dashboard.mjs
```

## What's especially welcome

- **A new board** — add an entry to `templates/sources.yaml`. Use
  `type: api` for boards with JSON endpoints, `type: html` for
  direct-fetch HTML boards. (SPA-rendered / auth-walled boards wait
  for browser-MCP support.)
- **A new domain template** — Argopia ships speech-AI defaults. If
  your tech stack is different, contribute `templates/profile.yaml`,
  `templates/criteria.yaml`, and a starter rubric. Nothing under
  `scripts/` or `.claude/` should need changes — if it does, that's a
  bug worth flagging.

## Conventions

- **Conventional Commits** for commit messages — `feat(scope):`,
  `fix(scope):`, `docs:`, etc. One-line subject.
- **No new npm dependencies** without discussion. The project ships
  with two (`js-yaml`, `ajv`) and aims to keep it that way.
- **Stay domain-generic.** Slash-command bodies and scripts must not
  hardcode "speech" or any specific domain — the engine serves any
  CV by swapping `working/`.

## Reporting bugs

Use the [issue tracker](https://github.com/samson-ailabs/argopia/issues)
with the bug-report template. Include what you ran, what you expected,
what happened, and your Node version.
