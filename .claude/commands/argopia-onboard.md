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

Keep this command **thin** — substantive prompts live in the agent
files, not here. Your context only holds the orchestration plan + each
agent's JSON status report.

The argument is: $ARGUMENTS

## Flow

```
Step 0  validate $ARGUMENTS
Step 1  seed working/ from templates/default/
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
5. **Apply per-step `on_failure` behavior** and **hold per-step
   `keep_for_checklist` fields** (defined below).

## Step 0 — Validate input

- If `$ARGUMENTS` is empty or the file doesn't exist: ask for a CV
  path (PDF or Markdown only). Stop until provided.
- If the path doesn't end in `.pdf` or `.md`: refuse and explain we
  only support those two formats.
- Resolve `$ARGUMENTS` to an absolute path (subagents may run in a
  different cwd). Use `realpath` or equivalent.

## Step 1 — Seed working/

Always use `templates/default/` — the domain-agnostic shipped
scaffold. (Power users wanting curated domain keywords can swap in a
custom template manually after onboarding.)

Run:
```
node scripts/onboard.mjs default
```

This **overwrites** `working/` (drops any prior files including the
`.verified` marker) and copies the three template files in verbatim,
preserving comments and inline shape documentation. Template defaults
are baked into the YAML files themselves — no synthesis at copy-time.

**Re-onboarding is destructive.** If the user has custom edits in
`working/` they want to keep, advise them to back up first
(`cp -r working/ working-bak/`).

If the script errors that `templates/default/` is missing, the clone
is incomplete — surface the error and stop.

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
| Inputs                | `domain: default`                                                           |
| Description           | `"Argopia criteria-deriver"`                                                |
| On `status != "ok"`   | Surface the failure but **don't roll back** — user can re-run manually.     |
| Keep for checklist    | `auto_filled` map                                                           |

## Step 4 — Print review checklist

**Data gathering**: read `working/sources.yaml` once to extract Active
(`enabled: true`) and Skipped (`enabled: false`, typically auth-walled)
board lists. No separate sources output before the checklist.

**Styling rules:**
- Markdown: `**bold**` for labels, `*italic*` for parenthetical
  context, `` `inline code` `` for field/value names.
- Unicode glyphs: `✓` (done), `▸` (bullets), `⚠` (attention), `──`
  (divider). No emojis.
- ≤40 lines total.
- Pull bracketed values from each subagent's JSON status. Group
  similar items where natural. Example values below are illustrative
  — substitute the candidate's actual data.

**Output template:**

```
**✓ Onboarded** with the default template

**Profile** *(extracted from your CV)*
  ▸ **Filled:** `candidate`, `experience`, `education`, `projects`, `publications`, `awards`, `tech_stack`
  ▸ **Stayed empty** — fine if your CV didn't mention them:
      Contact: `twitter`, `blog`, `portfolio`, `website`
      Employment: `employment_type`, `team_size_managed` for IC roles
      Misc: project URLs, publication citations, language test scores
      Sections: `patents`, `open_source`, `certifications`, `talks`, `volunteering`
  ▸ **Recovered:** <url_recovery_succeeded> of <url_recovery_attempted> publication URLs
  (Omit the recovery bullet if url_recovery_attempted = 0.)

**Criteria** *(derived from your profile)*

  **Auto-filled** — please review and adjust:
    ✓ `search_query`: `"speech"`
    ✓ `target.level`: `[Lead, Principal, Staff, Head]` *(current title: Lead AI Engineer)*
    ✓ `timezones`: preferred `[APAC]`, acceptable `[EMEA]` *(Vietnam)*
    ✓ `excluded_companies`: added `"VoxLab AI"` *(your current employer)*
    ✓ **Keywords:** 16 job titles, 12 token sets, 24 technical, 12 tools
    ✓ **5** work-auth deal breakers, **3** nice-to-haves from CV signals

  **⚠ Needs your judgment** *(template defaults):*
    ▸ `remote_only`, `open_to_relocate`, `max_listing_age_days` *(currently 90)*
    ▸ `must_haves` *(empty — what would you walk away from a role for missing?)*
    ▸ `keywords.negative` *(industries/values to avoid)*

**Sources** *(preset — yours to edit)*
  ▸ **Active:** `remoteok`, `remotive`, `ai_jobs_net`, `huggingface`, `himalayas`, `wellfound`, `welcome_to_the_jungle`
  ▸ **Skipped** *(auth-walled)*: `linkedin`, `ycombinator`, `itviec`
  ▸ Edit `working/sources.yaml` to toggle boards or tune `max_listings`

──────────────────────────

**Next steps:**

1. Open `working/profile.yaml` and `working/criteria.yaml`. Skim and
   edit anything off — agents can mis-split joined names, mis-classify
   keywords, or miss CV nuance.

2. *(Optional)* Tweak `working/sources.yaml` if you want to toggle
   boards or adjust `max_listings`.

3. Run `/argopia-verify` when satisfied.
```

Don't dump full file contents back at the user — they open the YAMLs
themselves to inspect.

## Token discipline

- The orchestrator only holds: the plan + each subagent's JSON status.
  The CV body and the YAMLs themselves stay in the subagents' contexts.
- Never re-read `profile.yaml` or `criteria.yaml` here — trust the
  subagents.
- Don't restate or duplicate guidance from the agent files. If a
  user-facing rule needs to change, edit the agent file, not this one.
