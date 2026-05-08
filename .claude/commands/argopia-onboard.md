---
name: argopia-onboard
description: CV → structured profile and criteria. Orchestrates profile-extractor and criteria-deriver subagents.
argument-hint: <path-to-cv.pdf-or-markdown>
---

You are the entry point for Argopia onboarding. You orchestrate two
subagents that populate `working/` from the user's CV:

1. **profile-extractor** → `working/profile.yaml`
2. **criteria-deriver** → `working/criteria.yaml`

`working/sources.yaml` ships preset; the orchestrator does not modify
it (the user is welcome to edit it later).

`working/` file shapes are defined by `schemas/{profile,criteria,sources}.schema.yaml`.
The agents follow them as the source of truth.

Keep this command **thin** — substantive prompts live in the agent
files, not here. Your context only holds the orchestration plan + each
agent's JSON status report.

The argument is: $ARGUMENTS

## Flow

```
Step 0  validate $ARGUMENTS
Step 1  seed working/ from templates/
Step 2  spawn profile-extractor → working/profile.yaml
Step 3  spawn criteria-deriver  → working/criteria.yaml
Step 4  print review checklist
```

## Agent dispatch protocol (used by Steps 2 & 3)

For each agent invocation:

1. **Read** the agent file (`agents/<name>.md`) with the Read tool.
2. **Substitute** the file's `## Inputs` block verbatim with the
   step-specific inputs.
3. **Spawn** via the Agent tool. Pick `subagent_type` by checking your
   session's available subagent_types list:
   - **If `<name>` is listed** (Argopia is plugin-loaded): prefer it.
     The `prompt` only needs the substituted Inputs block — the
     agent's frontmatter (tools, MCP) is loaded from the plugin.
   - **Otherwise**: use `general-purpose` (the agents need Edit, which
     Explore lacks). Pass the full agent file content with the Inputs
     block substituted as the `prompt`.
   - `description`: `"Argopia <name>"`.
4. **Wait** for the JSON status return.
5. **Apply** the per-step failure behavior and remember the per-step
   JSON fields for the Step 4 checklist (each step's table specifies both).

## Step 0 — Validate input

- If `$ARGUMENTS` is empty or the file doesn't exist: ask for a CV
  path (PDF or Markdown only). Stop until provided.
- If the path doesn't end in `.pdf` or `.md`: refuse and explain we
  only support those two formats.
- Resolve `$ARGUMENTS` to an absolute path (subagents may run in a
  different cwd). Use `realpath` or equivalent.

## Step 1 — Seed working/

**Safety check first.** Check if any canonical file already exists in
`working/`:
```bash
ls working/profile.yaml working/criteria.yaml working/sources.yaml 2>/dev/null
```

If anything prints, re-onboarding would overwrite the user's edits.
Ask via the AskUserQuestion tool:
- **Rename existing** — rename each canonical to `{name}-<timestamp>.yaml` (kept alongside the fresh seeds in `working/` for easy diffing).
- **Overwrite** — replace canonicals directly (no backup).
- **Cancel** — stop without changes.

If the user picks **Rename existing**:
```bash
TS=$(date -u +%Y-%m-%dT%H%M)
for f in profile criteria sources; do
  [ -f "working/$f.yaml" ] && mv "working/$f.yaml" "working/$f-$TS.yaml"
done
```
Then proceed to seed.

If the user picks **Cancel**, STOP.

Otherwise (**Overwrite**, or no canonical file exists), seed:
```bash
node scripts/onboard.mjs
```

This copies the three template files from `templates/` into `working/`
verbatim, preserving comments and inline shape documentation. Other
files in `working/` (renamed backups, personal notes) are untouched.

If the script errors that `templates/` is missing or incomplete, the
clone is broken — surface the error and stop.

## Step 2 — Spawn profile-extractor

Apply the dispatch protocol with:

| Parameter             | Value                                                                       |
|-----------------------|-----------------------------------------------------------------------------|
| Agent file            | `agents/profile-extractor.md`                                               |
| Inputs                | `cv_path: <absolute path from Step 0>`                                      |
| Description           | `"Argopia profile-extractor"`                                               |
| On `status != "ok"`   | Surface the failure verbatim and **stop** — don't proceed to Step 3.        |
| Keep for checklist    | `filled_sections`, `null_fields`, `empty_list_sections`, `url_recovery_*`   |

## Step 3 — Spawn criteria-deriver

Apply the dispatch protocol with:

| Parameter             | Value                                                                       |
|-----------------------|-----------------------------------------------------------------------------|
| Agent file            | `agents/criteria-deriver.md`                                                |
| Inputs                | (none)                                                                      |
| Description           | `"Argopia criteria-deriver"`                                                |
| On `status != "ok"`   | Surface the failure but **don't roll back** — user can re-run manually.     |
| Keep for checklist    | `auto_filled` map                                                           |

## Step 4 — Print review checklist

**Data gathering**: read `working/sources.yaml` once to extract two
source lists — Active (entries where `enabled: true`) and Disabled
(`enabled: false`). Both are dynamic; pull whatever is actually in the
user's working file, not hardcoded names.

**Styling rules:**
- Markdown: `**bold**` for labels, `*italic*` for parenthetical
  context, `` `inline code` `` for field/value names.
- Unicode glyphs: `✓` (done), `▸` (bullets), `⚠` (attention), `──`
  (divider). No emojis.
- Substitute every `<placeholder>` in the template with real data from
  the subagent JSON / sources.yaml. Group similar items where natural.
- Omit the **Recovered** bullet entirely when `url_recovery_attempted = 0`.
- Don't dump full file contents — the user opens YAMLs to inspect.

**Output template:**

```
**✓ Onboarded**

**Profile** *(extracted from your CV)*
  ▸ **Filled:** <comma-sep section names from profile-extractor's `filled_sections`>
  ▸ **Stayed empty** — fine if your CV didn't mention them:
      Contact: `twitter`, `blog`, `portfolio`, `website`
      Employment: `employment_type`, `team_size_managed` for IC roles
      Misc: project URLs, publication citations, language test scores
      Sections: `patents`, `open_source`, `certifications`, `talks`, `volunteering`
  ▸ **Recovered:** <url_recovery_succeeded> of <url_recovery_attempted> publication URLs

**Criteria** *(derived from your profile)*

  **Auto-filled** — please review and adjust:
    ✓ `search_queries`: <list of values>
    ✓ `target.level`: <list> *(current title: <CV current_title>)*
    ✓ `timezones`: preferred <[REGION]>, acceptable <[REGION]> *(<candidate.location.country>)*
    ✓ `excluded_companies`: added <"company name(s)"> *(your current employer)*
    ✓ **Keywords:** <N> job titles, <N> token sets, <N> technical, <N> tools
    ✓ **<N>** work-auth deal breakers, **<N>** nice-to-haves from CV signals

  **⚠ Needs your judgment** *(template defaults):*
    ▸ `remote_only`, `open_to_relocate`, `max_listing_age_days` *(currently 90)*
    ▸ `must_haves` *(empty — what would you walk away from a role for missing?)*
    ▸ `keywords.negative` *(industries/values to avoid)*

**Sources** *(preset — yours to edit)*
  ▸ **Active:** <comma-sep list of source slugs where `enabled: true`, read from working/sources.yaml>
  ▸ **Disabled:** <comma-sep list of source slugs where `enabled: false`>
  ▸ Edit `working/sources.yaml` to toggle boards or tune `max_listings`

──────────────────────────

**Next steps:**

1. Open `working/profile.yaml` and `working/criteria.yaml`. Skim and
   edit anything off — agents can mis-split joined names, mis-classify
   keywords, or miss CV nuance.

2. *(Optional)* Tweak `working/sources.yaml` if you want to toggle
   boards or adjust `max_listings`.

3. Run `/argopia-scan` when satisfied.
```

## Token discipline

- The orchestrator only holds: the plan + each subagent's JSON status.
  The CV body and the YAMLs themselves stay in the subagents' contexts.
- Never re-read `profile.yaml` or `criteria.yaml` here — trust the
  subagents.
- Don't restate or duplicate guidance from the agent files. If a
  user-facing rule needs to change, edit the agent file, not this one.
