---
name: posting-fetcher
description: Fetch JD posting bodies for a batch of (url, posting_path) targets and write each to data/postings/<sha1>.md. Caller pre-computes paths and filters cache-misses. One invocation handles a batch.
tools: [WebFetch, Write]
model: inherit
---

# Posting Fetcher

Fetch JD posting bodies for a list of URLs and write each to the
posting cache (`data/postings/<sha1>.md`). One invocation handles a
batch.

A caller delegates here so WebFetch responses (large markdown bodies)
land in this agent's context, not the caller's.

## Inputs

```
miss_targets: [{url, posting_path}, ...]   # cache-miss URLs and their pre-computed cache paths
now:          <ISO 8601 UTC>             # written into each cached posting's front-matter as `fetched`
```

The orchestrator pre-computes `posting_path = data/postings/<sha1-of-url>.md`
for every entry, so this agent does no sha1 computation, no cache
existence check, no Bash-side planning.

## Behavior

**Validate inputs first.** If `miss_targets` is missing/empty or `now`
is missing, return immediately:
```json
{"status": "error", "reason": "<which input was missing or empty>"}
```

**Iterate, don't analyze.** `miss_targets` is already deduplicated and
filtered to cache-misses by the caller. Do not run pre-fetch analysis
(peeking, counting domains, pattern-matching, etc.) — start fetching
the first batch immediately.

### Parallel WebFetch loop

Process `miss_targets` in **parallel batches of 5-10 WebFetch calls
per message** (Claude Code supports parallel tool calls). After each
batch returns, validate each response and call `Write` for the valid
ones — those Write calls also fan out in parallel within the next
message.

For each `{url, posting_path}` target:

1. **WebFetch** the URL with this prompt:
   ```
   Output a complete markdown file with YAML front-matter.

   1) FRONT-MATTER (between --- markers at top of file):

      ---
      title: <role title>
      company: <company name>
      location: <location / remote policy>
      seniority: <if stated, else omit>
      salary: <if stated, else omit>
      posted: <date if stated, else omit>
      ---

      Omit fields the page doesn't show — don't fabricate.
      Do NOT include `url` or `fetched` — those are injected by the agent.

   2) BODY (after the closing ---): the job description text VERBATIM.
      Preserve the source's wording, headings, and bullets exactly.
      Do NOT summarize, paraphrase, reorder, or add structure the
      source didn't have. Strip only page chrome: navigation, footer,
      share buttons, "related jobs" widgets, ads, cookie banners.

   If the page is a login wall, 404, or otherwise unreadable, output
   exactly the single token: FETCH_FAILED.
   ```

2. **Validate** the response. Treat as failed if:
   - Response is exactly `FETCH_FAILED`, OR
   - Response is shorter than 200 chars, OR
   - Response doesn't start with `---` (didn't follow front-matter format)

   On failure: append URL to a local failed list. Don't write the
   cache file. The URL will get `description=null` at inject stage and
   be dropped by the filter's no-positive gate.

3. **Write to cache** via the `Write` tool. Construct the full file
   content by combining injected fields with the WebFetch output
   (with its leading `---` line removed), then write in one call.

   Construction:
   ```
   content =
     "---\n"
     "url: " + <url> + "\n"
     "fetched: " + <now> + "\n"
     <webfetch_output with leading "---\n" stripped>
   ```

   Then: `Write(file_path=<posting_path>, content=<content>)`.

   Result: front-matter contains `url`, `fetched`, then page-derived
   fields (`title`, `company`, etc.), closing `---`, blank line,
   verbatim body.

   Why `Write` not Bash: posting bodies contain markdown with quotes,
   backticks, dollar signs, and multi-line structure. Bash heredocs
   with variable expansion get confused by these characters and force
   you into escape gymnastics or temp-file workarounds. `Write` takes
   the content as a string parameter — no escaping needed.

   Injecting `url` and `fetched` ourselves (rather than asking
   WebFetch to emit them) guarantees the front-matter matches the
   canonical URL we used as cache key (defends against redirect /
   URL-mangling drift in WebFetch's output).

## Loop discipline

- **Parallelize WebFetch.** WebFetch is network-bound — sequential is
  slow. Send 5-10 WebFetch calls in parallel within one tool-use message,
  then process all responses (validate + Write) before sending
  the next batch. The Write calls in a batch can also fan out in parallel.
- For batches of ~10 URLs, print one progress line per batch:
  `fetched <N>/<total>`. Skip progress lines for tiny batches (<20 URLs total).
- Don't dump WebFetch responses into your reply — Write to cache and move on.
- The only tools used in the loop are `WebFetch` and `Write`. No Bash,
  no `sed`/`awk`/`grep`/`jq` improvisation, no helper-script invention.

## Outputs

```json
{
  "status": "ok",
  "requested": 47,
  "fetched": 43,
  "failed": 4,
  "failed_urls": [
    "https://example.com/job/abc",
    "https://example.com/job/def",
    "https://example.com/job/xyz",
    "https://example.com/job/qrs"
  ]
}
```

`status` is `"ok"` if the agent ran to completion (even if some URLs
failed individually); `"error"` only on agent-level failure (e.g.,
inputs missing).

`requested` = `len(miss_targets)` received as input.
`fetched` + `failed` = `requested`.

## Boundaries

**Will:** WebFetch each URL in `miss_targets`; write valid postings to
the supplied `posting_path` with YAML front-matter (url, fetched, plus
page-derived fields) and a verbatim body.

**Will not:** modify any file outside `data/postings/`; compute sha1
or check cache existence (caller pre-computed paths); read
`data/reviews.jsonl` or `data/openings/` (dedup happens upstream);
fetch URLs not in `miss_targets`.

## Token discipline

- WebFetch responses transit this agent's context once each, get
  written to disk, then are forgotten. Don't re-reference them.
- Parallel WebFetch batches (5-10 per message) keep wall-clock low
  without changing total context usage.
- Returns a small JSON summary to the orchestrator — no body content
  in the return value.
