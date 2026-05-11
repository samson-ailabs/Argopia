---
name: argopia-advise
description: On-demand reflection on your review history — CV edits, criteria tweaks, pipeline health
---

You are running Argopia advise. Goal: turn `data/reviews.jsonl` (and
the cached postings each line points at) into a **career-intelligence
reflection** — what the market wants vs. what the CV shows, with
concrete edits to close the gap.

**Scope discipline.** Advise helps the user's CV, search criteria,
and skill direction *evolve over time*. It is not an application
coach. Specific apply/skip decisions belong in the dashboard, where
the user sees full postings, their own triage state (already
applied / saved / skipped — stored in browser localStorage that
advise can't see), and personal context advise has no view of
(bandwidth, prior outreach, gut feel on company). Mentioning a
company is fine as *evidence* — cite which JDs a phrase appears in
to ground a claim ("<phrase> repeats across N of M high-score JDs:
<list company names>"). Prescribing "apply to <company>" is out
of scope.

This is **on-demand only**. Do not auto-run from `/argopia-review`.

## Pre-flight

1. **Setup state.**
   - If `working/profile.yaml` does NOT exist:
     > Argopia isn't set up yet. Run `/argopia-onboard <path-to-cv.pdf>`.
     STOP.
   - If `data/reviews.jsonl` does NOT exist or is empty:
     > No reviews on record yet. Run `/argopia-survey` then `/argopia-review` first.
     STOP.

2. Read `data/reviews.jsonl`. Parse each line as JSON; skip malformed
   lines. Count records, then branch on N:
   - **N < 5**: refuse with *"Too few reviews for useful advice — run more survey/review first."* and STOP.
   - **5 ≤ N < 10**: print one line to chat first — *"N=<N> is below the noise floor; advice will be directional only."* — then proceed.
   - **N ≥ 10**: proceed normally.

3. Read `working/profile.yaml` and `working/criteria.yaml` once.

4. **Body reads are lazy and bounded.** Posting bodies are touched
   only inside CV positioning and CV gap; the other two analyses run
   on `reviews.jsonl` fields alone. Front-matter facts (title,
   company, location, posted) are already in `reviews.jsonl` — touch
   the body only for prose (phrase extraction, term frequency).
   Sampling rule when reading bodies:
   - **≤ 50 reviews**: read every posting referenced.
   - **> 50 reviews**: read every posting where `score ≥ 70`, plus
     every 5th `score < 70` review by file order (deterministic — same
     advise run twice samples the same postings).

## Execution order

**Compute cheap-first.** Pipeline health runs on structured
`reviews.jsonl` fields only — no posting body reads. Run it first as
a triage gate:

- If `apply_count == 0` (zero JDs scored ≥ 70): short-circuit. Skip
  the body-read analyses (CV positioning, CV gap) — there's nothing
  for positioning rewrites to extract from, and CV gap rankings are
  dominated by `research`-tier noise. The output structure shifts
  accordingly (see Output → Short-circuit case).
- Otherwise: run the remaining three analyses. Read posting bodies
  as needed.

The four analyses feed a **synthesized verdict** at the top of the
report — they're raw material, not the final output. The model's job
is to extract concrete actions from them.

## Analysis sections

Compute the four analyses below in-context. `reviews.jsonl` is
loaded; posting bodies come from the lazy sampling rule above.

### 1. CV positioning — phrasings to mirror

For postings with `score ≥ 70`, read the body and extract 3-5-word
noun phrases from the JD's scope/responsibilities section.

**Section detection**: common headings are "Responsibilities",
"About the Role", "What You'll Do", "The Role", "Your Role", and
close variants (case-insensitive). Extract from the paragraphs
following such a heading up to the next heading or ~500 chars. Pool
extractions if multiple sections match. If no recognisable heading
exists, fall back to the first 800 chars of the body.

Cluster repetitions across postings. Keep clusters that appear in ≥3
high-score JDs. **Small-corpus fallback**: if fewer than 3 JDs scored
≥70, expand the pool to score ≥60 (research-tier near-misses) and
cluster across the broader set. In the report, name the fallback
explicitly — e.g. "drawn from 1 apply-tier JD plus 2 next-tier
near-misses" — so the user knows the clusters reflect a stretched
sample, not market consensus.

For each cluster:

1. Quote the source phrasing as it appears in JDs.
2. Find the closest existing claim in `profile.yaml`
   (`candidate.summary`, `experience[].achievements`,
   `projects[].achievements`). Quote it.
3. Propose a rewrite that adopts the JD's phrasing while staying
   honest about what the candidate actually did.

Aim for 5-8 concrete rewrite suggestions. Each should be specific
enough to apply directly to `working/profile.yaml`.

### 2. CV gap — terms in the market the CV doesn't claim

For every technical term appearing in JD bodies (frameworks,
libraries, models, architectures, tools, methodologies), compute a
score-weighted frequency:

```
term_weight = sum across appearances of max(0, score - 50) / 50
```

This makes a term appearing in an `apply`-tier JD (score 85) worth
~0.7, while the same term in a `research`-tier JD (score 60) is worth
0.2. Gate-failed JDs (score: null) contribute 0 — they're not jobs
the candidate would take anyway.

Cross-reference each term against `profile.yaml`: case-insensitive
substring check across `tech_stack` values, `experience[].achievements`,
`projects[].achievements`, `publications[].title`, and
`candidate.summary`. If found anywhere, the term is "in CV" — drop.

Output the top 5 missing terms by `term_weight`, with the raw count
of appearances alongside the weight.

**On effort claims**: don't label missing terms as "weekend / month /
quarter" learning targets — that's the user's call. *One exception*:
when the profile shows adjacent work that implies the term (uses a
built-on library, describes the same activity in different words),
labeling it a "vocabulary fix the user already practices" is fine —
the classification is grounded in quotable profile evidence.

### 3. Pipeline health — is the search working?

Compute directly from `reviews.jsonl` (cheap, no body reads):

- **Total reviewed**: N.
- **Recommendation breakdown**: count of `apply` / `research` / `skip`.
- **Apply-ratio**: `apply / total`, as a percentage. Flag:
  - `< 5%`: criteria are too tight OR market is poor. Suggest widening
    `keywords.positive` or expanding `acceptable_timezones`.
  - `> 30%`: rubric is too generous OR criteria too loose. Suggest
    tightening `keywords.positive` or adding `deal_breakers`.
  - `5-30%`: healthy range; no action.
- **Gate-failure breakdown**: among reviews with non-empty
  `gates_failed`, count each gate's frequency. The most-failed gate
  is the market's loudest "no" — suggest the corresponding criteria
  tweak (e.g. `region` fails 60% → either expand
  `acceptable_timezones` or accept the geo reality).
- **Recent trend** (only if ≥20 reviews): split into "last 30 days"
  vs "before". Apply-ratio rising or falling? Note the delta.

### 4. Criteria signals — what your scored corpus reveals about the market

- **Geo distribution** of reviewed JDs (from the `location` field):
  remote-anywhere / remote-region / region-locked. Suggest whether
  to bias surveys toward sources with better geo coverage.
- **Top hiring companies in apply tier**: top 5 by frequency among
  reviews with `score ≥ 70`. Pattern signal — what *kinds* of
  companies surface as fits for this CV. Describe the pattern; don't
  predict which specific company will produce the next apply-tier
  match. Not a list to apply to.
- **Soft-flag frequency**: which `soft_flags` entries fire across the
  corpus. Persistent `vague_scope` patterns may suggest the source
  boards favor junior-style postings; `crunch_signals` patterns may
  flag a market segment to avoid.

## Output

The report is **decision support**, not a research write-up. Lead
with the verdict; demote analysis to supporting evidence. The user
should be able to read only the top two sections and walk away
knowing what to do.

### File: `reports/advice/YYYY-MM-DD.md`

```markdown
# Argopia Advice — <YYYY-MM-DD>

> Source: <N> reviews on record (<X> apply-tier, <Y> research, <Z> skip).
> <Sample-size caveat — one short sentence — only if N < 25 or
> apply-tier < 5; otherwise omit.>

## Recommended this week

1. **<Primary action — the single most important thing>.** <Why,
   anchored in concrete evidence from the corpus (specific JDs, term
   frequencies, gate-failure rates).> <The literal change — the
   profile.yaml rewrite, the criteria.yaml edit, the sources.yaml
   adjustment.> <Estimated effort if quick.>
2. **<Secondary action.>** Same shape.
3. **<Tertiary action — often "don't change X yet, here's why">.**
   Same shape.

Up to 3 actions; fewer if the corpus doesn't warrant it. Don't pad.

**In-scope action types** — concrete edits to a `working/` file:

1. **CV rewrite** — change a claim in `profile.yaml` to mirror
   language repeating across high-score JDs. Highest leverage when
   apply-tier matches exist; the CV is already close to the market
   and small wording shifts compound.
2. **Criteria tweak** — adjust `working/criteria.yaml` (keywords,
   timezones, deal-breakers, level filters) when Pipeline health
   shows the search is mis-calibrated.
3. **Source-mix tweak** — adjust `working/sources.yaml` when
   Criteria signals show structural patterns (one board producing
   all the soft flags, a geo dimension under-represented).

Longer-horizon signals (skill gaps requiring real learning, market
shifts not yet actionable) belong in "Patterns to watch", not here.

## Patterns to watch

Corpus-level signals worth surfacing but not yet actionable. Common
shapes include:

- **Multi-quarter skill gaps** from CV gap — market terms repeating
  in high-score JDs that can't be added with wording alone
  (foundational skills, named platforms, methodologies).
- **Structural pipeline patterns** from Pipeline health or Criteria
  signals — geo distribution, board quality, recurring soft flags,
  which gates fire most.
- **Role-shape patterns** from CV positioning or top hiring
  companies — what *kinds* of roles surface as fits (e.g.
  infrastructure-leaning vs research-leaning within the same domain),
  useful for strategic positioning even when no single action follows.

1-3 items. Each: one short paragraph stating the pattern + what it
means. Skip if nothing notable surfaced.

## Why these recommendations

Supporting evidence for users who want to verify the reasoning or
browse corpus-level data. Section headings are descriptive (no
numbering — the order isn't a ranking).

### CV positioning rewrites

<Source phrasing → closest existing claim → suggested rewrite triples,
5-8 entries (per the format described in Analysis §1). This is the
evidence backing the top action(s).>

### Market terms missing from your CV

<Table: Term | Score-weighted | Raw appearances | Closest existing claim.
Top 5 by weighted frequency. Closing line: "You decide effort —
some are vocabulary fixes, others quarter-long projects.">

### Pipeline health

- **Reviewed**: N total — X apply / Y research / Z skip
- **Apply-ratio**: X% — <healthy | too tight | too loose> (band 5-30%)
- **Top failed gate**: `<gate>` (K% of reviews) — <interpretation>
- **30-day trend** (only if ≥20 reviews)

### Criteria signals

- **Geo distribution**: <breakdown + one-line suggestion if relevant>
- **Top hiring companies in apply tier**: …
- **Common soft flags**: <count + interpretation if persistent>

## Re-run this when

One short paragraph stating the threshold for the next useful run.
Anchor to the actual sample state, not a fixed cadence. Examples:
"after the next survey adds ≥15 new reviews and at least 2 more
apply-tier"; or "if apply-ratio drops below 5% over the next week".
The point is to keep the user from running advise on stale data and
getting the same report back.
```

### Short-circuit case (`apply_count == 0`)

Replace "Recommended this week" with one item: tune criteria and
re-run survey/review. Skip "Patterns to watch" entirely. In "Why
these recommendations", drop the CV positioning rewrites and Market
terms sections — they have no signal. Keep Pipeline health and
Criteria signals.

## Print to chat

Print a conversational synthesis. **No headline-style metric lists.**
Frame as a coach's quick verdict.

```
After <N> reviews:

This week: <one specific action, 1-2 sentences, with the why>.

Worth knowing: <one pattern or caveat the user should be aware of>.

Search status: <one sentence on apply-ratio band + N>.

Full report: reports/advice/<YYYY-MM-DD>.md
```

**Per-line rules:**
- *This week*: exactly one action. The file's "Recommended this
  week" list has up to 3; chat surfaces only the highest-leverage
  one. Don't compress two actions into one sentence — even if
  they're cohesive, the secondary stays in the file.
- *Worth knowing*: skip the line entirely when "Patterns to watch"
  in the file is empty. Mirroring the file's "skip if nothing
  notable" rule — don't fabricate a pattern just to fill the slot.
- *Search status*: append a small-N caveat to the sentence when
  N < 25 or apply-tier < 5.

Keep this under 10 lines. The user opens the file for the rest. Do
not use a headline-list style ("Top X by weighted Y") — that's
metrics-talk, not advice-talk.

**Anchor every line to specifics from the actual corpus**: quote
phrases, cite numbers, name source JDs. The shape to aim for —

> "Lift '<exact phrase from JDs>' into your <employer> summary — it
> repeats across N of M high-score JDs, and your current claim frames
> the same work as <weaker frame>."

beats "tighten your summary." Same shape for pipeline patterns —
"Every role in your corpus excludes <region> — widen sources if
this holds at N=25" beats "watch your geographic fit." Vague
coaching is worse than no coaching.

## Token discipline

Pure reasoning over cached data — no URL fetches, no helper scripts.
The sampling rules above bound body reads.
