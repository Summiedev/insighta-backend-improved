# SOLUTION.md - Stage 4B Route and Performance Notes

This document is the strict route-level summary for the current public surface and the Stage 4B requirements. It is written to match the implementation in this repository, not a theoretical design.

## Public Surface

The current public surface is:

- Auth: `/auth/github`, `/auth/github/callback`, `/auth/me`, `/auth/refresh`, `/auth/logout`
- Health: `/health`
- Seeding: `/seed`
- Profiles: `/api/profiles`, `/api/profiles/search`, `/api/profiles/export`, `/api/profiles/:id`

Profiles are the only public family using the `/api` prefix.

## Stage 4B Scope

Stage 4B performance work applies to the profile query family only:

- `GET /api/profiles`
- `GET /api/profiles/search`
- `POST /api/profiles` when used for CSV bulk upload
- `GET /api/profiles/export` is streaming-only and intentionally not cached
- `GET /api/profiles/:id` and `DELETE /api/profiles/:id` are direct record operations

Auth, health, and seeding routes are outside the Stage 4B normalization/caching scope because they are stateful, operational, or single-purpose endpoints.

## What Each Route Does

### `GET /api/profiles`

This is the structured profile query endpoint.

Implementation flow:

1. Read the request query.
2. Normalize filters with `normalizeFilters()`.
3. Build a canonical cache key with `canonicalKeyFromNormalized()`.
4. Check the in-process cache with `queryCache.get()`.
5. On cache miss, call `buildQuery()` and execute the MongoDB query.
6. Return the paginated response and store it in the cache for 5 seconds.

Implemented behaviors:

- Case-normalized `gender`
- Uppercased `country_id`
- Numeric coercion for age and pagination filters
- Stable key ordering for equivalent queries
- Min/max age swapping when bounds are reversed
- Pagination metadata in the response

### `GET /api/profiles/search`

This is the natural-language query endpoint.

Implementation flow:

1. Read `q` from the query string.
2. Parse it with the rule-based `parseNL()` parser.
3. Merge parsed filters with pagination and sort options.
4. Normalize the merged filters.
5. Build a cache key and check the cache.
6. On cache miss, build the MongoDB query and execute it.
7. Return the same paginated response shape as `GET /api/profiles`.

Implemented behaviors:

- Rule-based parsing only
- No LLM or external NLP dependency
- Supports gender synonyms, country names, and age ranges
- Produces the same cache key for semantically equal queries

### `POST /api/profiles`

This route has two modes:

- Single-profile creation when a JSON body is sent
- CSV bulk ingestion when `bulk=1` is present or `Content-Type: text/csv` is used

Bulk upload behavior:

- Streams the request body with `readline`
- Supports gzip input via `zlib.createGunzip()`
- Processes rows in batches of 1000
- Deduplicates by name
- Validates required fields and age values
- Continues after bad rows instead of rolling back the whole file
- Returns a summary with inserted and skipped counts plus rejection reasons

This is the Stage 4B CSV ingestion path.

### `GET /api/profiles/export`

This route streams CSV output for the current filtered profile set.

Important details:

- Admin only
- Uses the same query filters as the structured profile list endpoint
- Streams rows directly to the response
- Does not cache the export payload

### `GET /api/profiles/:id` and `DELETE /api/profiles/:id`

These are direct record operations for a single profile.

Important details:

- They are merged into the main `api/profiles/index.js` handler
- They do not use normalization or cache lookup because they operate on a specific record
- `DELETE` remains admin-only

## Implementation Boundaries

The code intentionally does not apply performance caching to every route.

Not cached:

- `/auth/*` routes
- `/health`
- `/seed`
- `GET /api/profiles/export`
- Direct record operations by id

Why:

- Auth and logout/refresh routes are stateful
- Health and seed are operational endpoints
- Export must remain fresh and streamable
- Direct record operations are already O(1)-style lookups by id and do not benefit from query caching

## Stage 4B Requirements Mapped to Code

### 1. Query normalization

Implemented in `src/queryNormalizer.js`.

Rules:

- `gender` is lowercased
- `age_group` is lowercased
- `country_id` is uppercased
- Numeric filters are coerced to numbers
- Reversed age bounds are swapped into canonical order
- Keys are sorted alphabetically before key generation

### 2. Query caching

Implemented in `src/queryCache.js`.

Details:

- In-process Map-based cache
- TTL-based expiration
- Default expiry used by the profile routes is 5000 ms

### 3. Natural-language search

Implemented in `src/nlParser.js` and consumed by `GET /api/profiles/search`.

Supported behavior:

- Gender synonyms such as female/women/girl and male/man/boy
- Country name mapping to ISO-2 codes
- Age expressions such as `20-45`, `aged 20 to 45`, and `between 20 and 45`

### 4. CSV streaming and batch processing

Implemented in `POST /api/profiles`.

Details:

- Streams request input instead of buffering the file
- Uses 1000-row batches
- Validates and skips invalid rows
- Preserves successful rows even when other rows fail

### 5. Response shape

Implemented across the profile query endpoints.

Expected response shape:

- `status`
- `page`
- `limit`
- `total`
- `total_pages`
- `links`
- `data`

The CSV upload route returns a summary object instead of the paginated list shape.


## Bottom Line

The implemented Stage 4B behavior is centered on `/api/profiles` and its sibling profile routes. The optimization stack is present where it matters: normalization, caching, NL parsing, CSV streaming, and batch ingestion.
