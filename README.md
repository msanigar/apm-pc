# Adopt Me Value Checker

A lightweight, ad-free web app for checking Adopt Me (Roblox) pet and item RP
values. Fuzzy search, mobile-first UI, daily-refreshed values aggregated from
several community sources.

> Fan-made project. Not affiliated with Roblox, Uplift Games, or Adopt Me.
> Values are community estimates and may vary by trade.

---

## Stack

- **Vite + React + TypeScript** — single-page app, builds to static assets.
- **Tailwind CSS v4** — utility-first styling via the `@tailwindcss/vite` plugin.
- **Fuse.js** — client-side fuzzy search over a compact, daily-cached index.
- **React Router** — `/` (search) and `/items/:slug` (item detail).
- **Netlify Functions** — API endpoints + a daily scheduled sync.
- **Supabase** — Postgres (canonical items, aggregated values, audit log) +
  Storage (cached item/pet images).
- **Vitest** — pure-unit tests for the parser, aggregator, diff, and
  validation logic.

---

## Project layout

```
.
├── netlify/functions/        Netlify Functions (API + scheduled sync)
│   ├── health.ts
│   ├── search-index.ts        GET /api/search-index
│   ├── items.ts               GET /api/items/:slug
│   ├── import-runs-latest.ts  GET /api/import-runs/latest
│   └── sync-values.ts         scheduled: daily import
├── public/                   Static assets served as-is
├── scripts/runSyncLocal.ts   Run the sync pipeline locally
├── src/
│   ├── components/           React UI building blocks
│   ├── pages/                Route-level components
│   ├── lib/                  Frontend utilities (api client, formatters, hooks)
│   ├── server/               Server-only code (Supabase, sync pipeline, adapters)
│   │   ├── repo.ts
│   │   ├── images.ts
│   │   ├── supabase.ts
│   │   ├── syncValues.ts
│   │   └── sources/          SourceAdapter implementations
│   └── shared/               Pure utilities shared by frontend + functions
│       ├── types.ts
│       ├── variants.ts
│       ├── parseSearchQuery.ts
│       ├── aggregate.ts
│       ├── normalize.ts
│       ├── slug.ts
│       ├── validate.ts
│       └── __tests__/        Vitest test suites
├── supabase/
│   ├── migrations/           Schema migrations
│   └── seed/README.md        Notes on seeding
├── netlify.toml              Build, redirects, schedule config
├── eslint.config.js
├── vite.config.ts
├── vitest.config.ts
└── tsconfig*.json
```

---

## Local setup

### Prerequisites

- Node.js 20+ (we test on 24).
- Optional: [Netlify CLI](https://docs.netlify.com/cli/get-started/) for
  running the Functions locally.
- Optional: a Supabase project if you want to test against real persistence.

### Install

```bash
npm install
cp .env.example .env
```

### Run the frontend only

```bash
npm run dev
```

The frontend will call `/api/*` — without the Netlify dev server those calls
will 404. For an end-to-end experience, use the Netlify dev server instead.

### Run the frontend AND the Netlify Functions

```bash
npm run dev:netlify
```

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are unset, the API
functions fall back to **in-memory mock data** built from the same fixtures
the mock adapters use. You can browse the UI and the item detail pages
without configuring Supabase at all.

### Run a one-off sync

```bash
npm run sync:local
```

- With Supabase env vars set: writes to your Supabase project (full pipeline).
- Without: prints a dry-run report (`"dryRun": true`).

### Tests, types, lint

```bash
npm run test          # vitest one-shot
npm run test:watch    # vitest watch
npm run typecheck     # tsc -b
npm run lint          # eslint
npm run build         # vite production build
```

---

## How values are produced

The interesting work happens in `src/server/syncValues.ts`. The pipeline is:

1. **Fetch.** Each enabled `SourceAdapter` returns a `RawSourceValue[]`. We
   call them in parallel via `Promise.allSettled` so one failing source can't
   take the rest down.
2. **Normalise.** `normalizeSourceValues` strips variant prefixes
   (`"FR Shadow Dragon"` → name: `Shadow Dragon`, variant: `fly_ride`),
   canonicalises via the alias map, drops zero/negative values, slugifies, and
   spits out `NormalizedSourceValue[]`.
3. **Group.** `buildCandidateDataset` keys rows by `(itemSlug, variant)` and
   collects one value per source.
4. **Load.** We load the current live `aggregated_values` snapshot from
   Supabase.
5. **Diff.** `diffDatasets` produces `common`, `liveOnly`, `candidateOnly`
   slices.
6. **Validate.** `validateCandidateDataset` decides whether the import is
   _fatal_ (whole thing is rejected) and which `(itemSlug, variant)` pairs
   should be **held back** as suspicious. See thresholds in
   `src/shared/validate.ts`.
7. **Promote.** Safe rows are upserted into `aggregated_values`. Suspicious
   rows keep their previous value but record `last_candidate_value_rp` /
   `last_candidate_at` so an operator can see what we rejected.
8. **Log.** Every raw value goes into `source_values` (forever; rotate as
   needed). Every issue goes into `import_validation_issues`. The
   `import_runs` row is closed with a status of `promoted`, `partial`,
   `rejected`, or `failed`.
9. **Cache images.** Any source-provided image URLs get downloaded into
   Supabase Storage at `items/<slug>.<ext>`. Stub today; ready for real
   adapters.

The aggregator uses **median** with 3+ sources (rejecting outliers) and the
mean otherwise — see `src/shared/aggregate.ts`.

---

## Source adapters

All adapters live in `src/server/sources/`. Each one is a `SourceAdapter`
returning `RawSourceValue[]`. Adapters MUST NOT be imported from frontend
code; they are only ever called from the scheduled sync function.

### Built-in adapters

| Source                | Internal source name(s)                       | Default | Env flag                          |
| --------------------- | --------------------------------------------- | ------- | --------------------------------- |
| Mock A / B / C        | `mock-a`, `mock-b`, `mock-c`                  | on      | (always available)                |
| AMVerse               | `amverse_elvebredd`, `amverse_amvgg`          | off     | `ENABLE_AMVERSE=1`                |
| Adopt Me Trading Vals | `adoptmetradingvalues`                        | off     | `ENABLE_ADOPT_ME_TRADING_VALUES=1`|
| └ legacy `.com` mirror| `adoptmetradingvalues_legacy`                 | off     | `ENABLE_AMTV_LEGACY_MIRROR=1`     |
| GitHub static dataset | `github_ironbabatekkral`                      | off     | `ENABLE_GITHUB_DATASET=1`         |
| └ high-tier fallback  | `github_high_tier`                            | off     | `ENABLE_GITHUB_HIGH_TIER=1`       |

`VALUE_SOURCE_ADAPTERS` can override the selection:

- unset → all adapters whose `ENABLE_*` flag is on, plus the mocks.
- `mock-only` → just the three mocks.
- comma-separated list of names → only those, in that order.

Each real adapter is wrapped in `safeAdapter()`, so a single failing source
returns `[]` instead of breaking the whole sync. The validation step decides
whether the import is still healthy.

### Why two source names from AMVerse?

The AMVerse values page is itself a meta-aggregator of two community
sources (Elvebredd and AMVGG). We split it into two logical sources so
median aggregation across all enabled sources gets two independent votes
from AMVerse rather than one fused one.

### Adding a brand-new adapter

1. Create `src/server/sources/myAdapter.ts`. The file should export a
   `buildMyAdapter(options): SourceAdapter[]` factory.
2. Use the shared helpers in `lib.ts` for HTTP (`fetchText`/`fetchJson`),
   value parsing (`parseRpValue`), image URL normalisation
   (`resolveImageUrl`), row building (`normalizeSourceValue`), and
   error/disable wrapping (`safeAdapter`).
3. Add a representative HTML/JSON fixture under
   `src/server/sources/__fixtures__/` and a fixture-based test in
   `src/server/sources/__tests__/`. Do **not** hit live network in tests.
4. Register the adapter (and its env flag) in
   `src/server/sources/index.ts`.
5. Verify the source's terms of service before enabling in production.
   Image caching is opt-in per source — surface an `imageUrl` from the
   adapter, but leave the cache step disabled until image-use terms are
   confirmed.

---

## Supabase

Apply the migration in `supabase/migrations/20260101000000_init.sql` to your
project (via the Supabase dashboard, the CLI, or `psql`).

Tables:

| Table                       | Purpose                                                   |
| --------------------------- | --------------------------------------------------------- |
| `items`                     | Canonical pets/items + aliases + image path               |
| `item_variants`             | (item, variant) catalog                                   |
| `source_values`             | Raw per-source per-variant audit log                      |
| `aggregated_values`         | Live aggregated values the UI reads (one row per variant) |
| `import_runs`               | One row per scheduled sync                                |
| `import_validation_issues`  | Per-row issues raised during validation                   |
| `item_images`               | Metadata for images cached in Supabase Storage            |

Row-Level Security: anon role gets `SELECT` on the public-facing tables.
Writes only happen via the **service role key**, which lives exclusively in
Netlify Functions.

Storage: create a public bucket named `adopt-me` (or override via
`SUPABASE_IMAGE_BUCKET`). Images live at `items/<slug>.webp`.

---

## Deploying to Netlify

1. **Set environment variables** in the Netlify site:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` _(server-only — never expose this)_
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you ever start
     calling Supabase from the browser (the MVP doesn't).
   - Optional: `SUPABASE_IMAGE_BUCKET`, `VALUE_SOURCE_ADAPTERS`.
2. **Connect the repo.** Netlify reads `netlify.toml`, runs `npm run build`,
   and publishes `dist/`. Functions are auto-bundled with esbuild.
3. **Schedule.** The daily sync is defined in `netlify.toml` at
   `[functions."sync-values"].schedule = "15 6 * * *"` (06:15 UTC). Adjust
   to taste.
4. **First import.** After the first deploy, hit
   `/.netlify/functions/sync-values` once manually to populate the database.
   Subsequent imports happen on the cron.

---

## Endpoints

| Path                          | Method | Description                                          |
| ----------------------------- | ------ | ---------------------------------------------------- |
| `/api/health`                 | GET    | Liveness + reports whether Supabase is configured.   |
| `/api/search-index`           | GET    | Compact dataset for the client-side Fuse.js index.   |
| `/api/items/:slug`            | GET    | Full item detail + all aggregated variant values.    |
| `/api/import-runs/latest`     | GET    | Status of the most recent sync run.                  |
| `/.netlify/functions/sync-values` | GET | Manual trigger for the daily sync.               |

Responses are JSON. Cache headers default to `max-age=0, s-maxage=86400`
because everything refreshes daily.

---

## Constraints (the things we deliberately don't do)

- No scraping during user requests — only inside the scheduled job.
- No image hotlinking — images are cached into Supabase Storage.
- No blind overwrites — the diff/validation step decides whether to promote.
- No ads, no trackers, no third-party analytics scripts.
- No client-side use of the Supabase service role key.

---

## License

MIT (or pick your own — the project file does not set one yet).
