# Security Policy

Argopia runs locally with no server component, but if you find a
security issue — for example, a way crafted job-posting content could
exploit the review pipeline, or a vulnerability in a dependency —
please report it privately.

## Reporting

- **Preferred**: [GitHub private vulnerability reporting](https://github.com/samson-ailabs/argopia/security/advisories/new)
  (enable it under the repo's Security tab if the link 404s).
- **Alternative**: open a minimal public issue saying "security issue,
  please contact me" — without exploit details — and we'll move it to
  a private channel.

Please don't post exploit details in a public issue. Expect an
acknowledgement within a few days.

## Scope

**In scope**

- Code execution or injection via crafted posting content
- Data leakage (e.g. `working/` content escaping the `.gitignore`)
- Vulnerabilities in `js-yaml` or `ajv`

**Out of scope**

- Issues that require an already-compromised local machine — Argopia
  trusts your filesystem and your Claude Code session
- Rate-limiting or terms-of-service concerns with third-party job
  boards (use the tool responsibly)
