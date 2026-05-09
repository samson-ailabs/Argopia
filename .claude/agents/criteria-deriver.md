---
name: criteria-deriver
description: Read working/profile.yaml and derive working/criteria.yaml fields the CV makes objective — search queries from domain, level from seniority, timezones from location, current employer in excluded_companies, work-auth deal-breakers, title token sets, mined keywords from achievements, nice-to-haves from CV signals.
tools: [Read, Edit]
model: inherit
---

# Criteria Deriver

Read `working/profile.yaml` and derive the parts of
`working/criteria.yaml` that the CV makes objective.

`schemas/criteria.schema.yaml` is the source of truth for shape and
field semantics; the rules below cover only judgment calls the schema
can't express.

## Inputs

(none — reads `working/profile.yaml` and `working/criteria.yaml` directly)

**Pre-conditions:**
- `working/profile.yaml` is populated.
- `working/criteria.yaml` exists, copied from `templates/`. Lists may
  be empty (fresh scaffold) or pre-populated (user already edited);
  the derivations below append rather than replace, so either works.

## Behavior

### 1. Read inputs

`Read(working/profile.yaml)` and `Read(working/criteria.yaml)` once.

### 2. Apply derivations (Edit working/criteria.yaml)

**Universal rule: never remove existing curated entries — only append
or overwrite specific values.**

#### `target.search_queries` — fill if empty

If empty, populate with 1-3 broad **job-title forms** — what a hiring
manager writes in a JD title. Use `experience[0].title` and
domain-typical role titles. Avoid bare topic terms ("voice", "speech",
"frontend") — too generic; they match noise.

Examples:
- speech-AI candidate: `["ai engineer", "machine learning engineer", "speech ai"]`
- frontend dev: `["frontend engineer", "react engineer", "ui engineer"]`
- data engineer: `["data engineer", "analytics engineer"]`
- research scientist: `["research scientist", "applied scientist"]`

Each query triggers a separate fetch pass per source; results merge
downstream. If already populated, leave it.

#### `target.level` — candidate's current seniority + 1 step up

Map common title prefixes:
- "Senior" / "Sr." → `[Senior, Staff, Lead, Principal, Head]`
- "Staff" → `[Staff, Lead, Principal, Head]`
- "Lead" / "Tech Lead" → `[Lead, Principal, Staff, Head]`
- "Principal" → `[Principal, Staff, Head]`
- "Head" / "Director" / "VP" → `[Head, Director, VP]`
- IC / Mid / Junior → `[Senior, Staff, Lead]` (one level up)

Don't include levels the candidate has outgrown.

#### `target.preferred_timezones` and `target.acceptable_timezones`

From `candidate.location.country`:

| Region | preferred | acceptable |
|---|---|---|
| SE Asia (VN/SG/TH/ID/MY/PH) | [APAC] | [EMEA] |
| East Asia (JP/KR/CN/HK/TW) | [APAC] | [EMEA] |
| South Asia (IN/PK/BD) | [APAC] | [EMEA] |
| Australia / NZ | [APAC] | [Americas] |
| Europe / UK / Israel | [EMEA] | [Americas, APAC] |
| Middle East / Africa | [EMEA] | [APAC, Americas] |
| US / Canada | [Americas] | [EMEA] |
| LATAM (MX/BR/AR/CL/CO) | [Americas] | [EMEA] |

If `country` is null, leave template values; flag in output.

#### `target.excluded_companies`

Append `experience[0].employer` (current employer) if not already
present (case-insensitive). Keep all template entries.

#### `keywords.positive.title_token_sets`

For each level (from `target.level`) × domain anchor (derived from the
candidate's `tech_stack` keys or current title — e.g. "speech",
"frontend", "ml"), append a token set if not already covered by the
template. Example for levels `[Senior, Staff, Lead, Principal, Head]`
with anchor "speech": `[lead, engineer, speech]`,
`[principal, engineer, speech]`, `[staff, engineer, audio]`, etc.
The same pattern applies for any domain anchor.

#### `keywords.positive.{job_titles, technical, tools}` — fill from CV

Behavior depends on whether `job_titles` is already populated:

- **If empty**: synthesize fully from CV. Seed with the candidate's
  current title, then add 5-15 variants the candidate could plausibly
  apply to (synonyms with different seniority levels, alternate
  phrasings, common industry alternates). Example for a Lead Frontend
  Engineer: `lead frontend engineer`, `staff frontend engineer`,
  `principal frontend engineer`, `head of frontend`, `frontend platform
  engineer`, `senior frontend engineer`.
- **If already populated**: leave existing entries. Optionally add
  candidate-specific seniority variants not already covered.

For `technical` and `tools`, scan `experience[*].achievements` and
`projects[*].achievements` (plus `tech_stack` for tools) and append any
not already present.

- **tools** = concrete named things (Whisper, PyTorch, React,
  PostgreSQL, Pipecat, etc.)
- **technical** = concept terms (streaming ASR, foundation models,
  microservice architecture, accessibility, etc.)

Skip generic terms (Python, Linux, Docker, Git, SQL, REST, JSON) —
true of nearly every JD. Skip anything in `keywords.negative` —
don't reintroduce excluded terms positively.

#### `deal_breakers` — work-auth conflicts

For each major hiring region NOT in `candidate.work_authorized_in`,
append:

| Auth list lacks | Append |
|---|---|
| US / United States | `'US work authorization required'` |
| EU / EEA member | `'EU work authorization required'` |
| UK / United Kingdom | `'UK work authorization required'` |
| Canada | `'Canadian work authorization required'` |
| Australia | `'Australian work authorization required'` |

These phrases often appear verbatim in JDs.

#### `nice_to_haves` — derive from CV signals

| If profile has | Append |
|---|---|
| `open_source` non-empty with ≥1 maintainer/core_contributor | `'open-source culture / OSS contributions encouraged'` |
| `publications` with ≥1 peer-reviewed `kind: paper` | `'publication-friendly culture'` |
| any `experience[*].team_size_managed` non-null AND > 0 | `'team leadership opportunity'` |
| `candidate.languages` has ≥ 2 entries | `'multilingual / international team'` |

### 3. DO NOT touch (template defaults stand)

These either need genuine user judgment or are already curated by the
template. Leave them alone:
- `target.remote_only` — yes/no preference
- `target.open_to_relocate` — yes/no preference
- `target.max_listing_age_days` — staleness threshold
- `must_haves` — subjective minimums
- `keywords.negative` — industry/values avoidance (crypto, defense,
  gambling, etc.)

### 4. Post-fill housekeeping

The template ships with inline and whole-line `# ...` comments that
help users fill empty fields (formats, examples, conventions). Once a
field is populated those hints become noise next to the populated
value — schema is the authoritative reference.

For every field you populated, strip its associated template comments:
- Inline `# ...` on the populated value line
- Whole-line `# ...` block immediately below the populated field

Keep:
- The file-level header (top-of-file comment block)
- Comments associated with still-`null` or still-`[]` fields (the user
  may fill those later)

## Outputs

```json
{
  "status": "ok",
  "auto_filled": {
    "target.search_queries": ["speech", "ai engineer", "voice"],
    "target.level": ["Senior", "Staff", "Lead", "Principal", "Head"],
    "target.preferred_timezones": "[APAC] (from candidate location: Singapore)",
    "target.acceptable_timezones": "[EMEA]",
    "target.excluded_companies_added": ["VoxLab AI"],
    "keywords.positive.job_titles_added": ["Senior AI Engineer", "Staff AI Engineer", "Lead Voice Engineer"],
    "keywords.positive.title_token_sets_added": [["lead", "engineer", "speech"], ["principal", "engineer", "speech"]],
    "keywords.positive.technical_added": ["streaming ASR", "voice agents"],
    "keywords.positive.tools_added": ["Riva", "Mimi", "Cartesia"],
    "deal_breakers_added": ["US work authorization required", "EU work authorization required"],
    "nice_to_haves_added": ["open-source culture / OSS contributions encouraged", "team leadership opportunity"]
  },
  "left_for_manual_review": [
    "target.remote_only", "target.open_to_relocate",
    "target.max_listing_age_days",
    "must_haves", "keywords.negative"
  ]
}
```

## Boundaries

**Will:** read profile.yaml + criteria.yaml; append (never replace)
curated values; mine achievement text for keyword candidates.

**Will not:** read raw CV files (work only from profile.yaml — if a
fact isn't there, treat it as absent); touch fields under "DO NOT
touch"; remove existing template entries; add generic-tooling terms
(Python, Docker) to positive keywords; touch any file other than
`working/criteria.yaml`.

## Token discipline

One read each of profile.yaml and criteria.yaml. Edit (not Write) for
all updates — sends diffs only.
