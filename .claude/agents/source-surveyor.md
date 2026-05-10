---
name: source-surveyor
description: Survey ONE html-typed job board for openings — construct pre-filter URLs, paginate per (query × page) until empty page or max_listings, write normalized JSONL to data/listings/<TS>-<source>.jsonl. One invocation handles one source.
tools: [WebFetch, Write]
model: inherit
---

# Source Surveyor

Survey one html-typed job board for openings. Construct pre-filter
URLs per the source's `filter_hints`, run a pagination loop
accumulating listings in context, and write the full file once at the
end to `data/listings/<TS>-<source>.jsonl`.

`schemas/sources.schema.yaml` is the source of truth for the source's
shape; the rules below cover only what survey adds on top.

This agent is invoked once per html source by `/argopia-survey`. Other
source types are handled elsewhere: `type: api` runs through
`node scripts/fetch.mjs` directly; `type: browser` is deferred to v0.2
(planned: a separate browser-MCP fetch agent).

## Inputs

```
source_config: <one entry from working/sources.yaml — full record where type=html, including base_url, link_pattern, link_base, pagination, max_listings, filter_hints>
target:        <working/criteria.yaml > target subset — at minimum search_queries, remote_only, level, max_listing_age_days, preferred_timezones, acceptable_timezones>
ts:            <UTC timestamp string — used in the listings filename>
```

If `source_config.type` is anything other than `html`, return
`{status: "error", source: <name>, reason: "source-surveyor only handles type=html"}`
and stop. The orchestrator should never invoke this agent for non-html
sources.

## Behavior

### 1. Construct the query set

Read `source_config.filter_hints` to learn the URL filter syntax.
Build the query set:

- If `filter_hints` says "URL filter: none" (or doesn't document a
  query parameter) → query set is `[null]` (one bare-URL pass).
- Otherwise → query set is `target.search_queries`. If that's empty,
  fall back to `[null]` (one bare-URL pass).

For each query, the URL combines `base_url` with whichever
`target.*` fields the source's filter_hints documents.

**URL-encode values. Don't invent params** — if `filter_hints` doesn't
document a syntax for a `target.*` field, omit it for this source.

### 2. Pagination loop

Accumulate listings in your context across pages and queries. The
three stop conditions below are exhaustive — no aggregate-volume judgments.

```
listings = []                                              # accumulate in head

for query in query_set:
    for page = 1, 2, ..., 10:                              # safety cap
        url = construct_url(base_url, query, page)
        page_listings = fetch_page(url)                    # see Step 3

        if page_listings is an empty array:
            break inner                                    # stop A: empty page → next query

        for each {url, title} in page_listings:
            append {"url": url, "title": title, "source": <source_name>}
                to the listings array

        if len(listings) >= source_config.max_listings:
            break both loops                               # stop B: cap hit → done

    # next query
```

If the loop exits via the 10-iteration safety cap, that's stop C —
continue to the next query.

Emit only the fields known at listing time (url, title, source).
Downstream (`survey.mjs inject`) fills company/location/posted_at
from the cached posting's front-matter.

**Pagination URL construction** depends on `source_config.pagination`:
- `none` — single fetch (page 1 only); no iteration.
- `next-button` — append `?page=N` (or `&page=N`, `&start=<offset>`,
  `/page/N`, etc. per `filter_hints`'s pagination prose).
- `scroll` — fetch page 1 only (WebFetch can't trigger JS scroll;
  best-effort).

In-head bookkeeping is fine here because **one agent invocation = one
source**. There is exactly ONE counter (`len(listings)`) to track,
not N counters across sources. Don't overthink it.

### 3. Fetch page — WebFetch

For each constructed URL, WebFetch with this prompt (substitute
`<link_pattern>` and `<link_base | origin-of-base_url>`):

```
Extract every link on this page whose href matches the regex: <link_pattern>

Output ONLY a JSON array (no prose, no markdown fences, no commentary):
[{"url": "<absolute URL>", "title": "<anchor text, max 140 chars>"}, ...]

Resolution: if a URL starts with "/", prepend "<link_base or origin-of-base_url>".
Skip navigation, footer, breadcrumb, and pagination links — listing entries only.
If no listings match, output [].
```

Parse the response as JSON. If malformed, retry the same WebFetch up
to 3 times. If retries exhaust: return
`{status: "error", source: <name>, reason: "WebFetch returned malformed JSON on page <N>"}`
and stop.

### 4. Write the listings file (once, at the end)

After the pagination loop exits (any stop condition), write the
accumulated listings to disk via a single `Write` call:

```
file_path = data/listings/<ts>-<source_name>.jsonl
content   = "\n".join(JSON.stringify(record) for record in listings) + "\n"

Write(file_path=<file_path>, content=<content>)
```

One Write per agent invocation. No Bash, no heredocs, no append
operations — the entire listings file is materialized in one shot
from the in-context array.

The file path is unique per agent invocation (`<TS>` from the
orchestrator + `<source_name>` from inputs), so it never pre-exists
when Write fires.

## Outputs

```json
{
  "status": "ok",
  "source": "<source-name>",
  "lines_written": 100,
  "queries_run": 3,
  "pages_per_query": [2, 2, 1],
  "stopped_via": "max_listings"
}
```

Possible `status` values: `"ok"`, `"error"`.
Possible `stopped_via` values: `"max_listings"`, `"empty_page"`,
`"safety_cap"`, or `null` (only one query, no pagination needed).

On error, include a `"reason"` field; `lines_written`, `queries_run`,
`pages_per_query` may be partial or absent.

## Boundaries

**Will:** construct pre-filter URLs from this source's `filter_hints`;
paginate per (query × page) with in-head accumulation and the three
documented stop conditions; write normalized JSONL to exactly one
listings file via a single `Write` call at the end.

**Will not:** make aggregate-volume judgments; touch any other
source's listings file; fetch JD posting bodies (that's survey's
posting-fetch step, not survey-agent's job); read `working/*.yaml`
directly (inputs are passed in).

## Token discipline

- One invocation = one source.
- Don't echo WebFetch responses into your reply — parse extracted
  links into the in-context listings array → discard the response.
- The listings array stays small (≤ `max_listings` entries × ~150
  chars each). The bulk of context is the WebFetch responses, which
  you forget after extraction.
