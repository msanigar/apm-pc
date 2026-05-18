-- Egg hatching data — pets obtainable from each egg and per-tier hatch odds.
-- Populated by the Fandom (Adopt Me Wiki) adapter; ON CONFLICT keys on
-- (egg_id, ..., source) so the daily sync upserts the latest snapshot.

-- ============================================================================
-- egg_hatch_odds — per-rarity tier probability for each egg
-- One row per (egg, rarity, source). Multiple sources are supported even
-- though we currently only ingest from one (`fandom_wiki`).
-- ============================================================================
create table if not exists public.egg_hatch_odds (
  id                   uuid primary key default gen_random_uuid(),
  egg_id               uuid not null references public.items (id) on delete cascade,
  rarity               text not null,
  probability_pct      numeric(5,2),
  source               text not null,
  source_revision_id   text,
  fetched_at           timestamptz not null default now(),
  unique (egg_id, rarity, source)
);

create index if not exists egg_hatch_odds_egg_idx on public.egg_hatch_odds (egg_id);

-- ============================================================================
-- egg_hatch_pets — which pets hatch from each egg, with their rarity tier
-- One row per (egg, pet, source). `pet_id` is nullable so we can still
-- record pets the wiki lists that we haven't seen in any value adapter yet
-- — they hold a `pet_slug_snapshot` for forward-matching once they do show
-- up in the catalog.
-- ============================================================================
create table if not exists public.egg_hatch_pets (
  id                   uuid primary key default gen_random_uuid(),
  egg_id               uuid not null references public.items (id) on delete cascade,
  pet_id               uuid references public.items (id) on delete cascade,
  pet_slug_snapshot    text,
  pet_display_name     text,
  rarity               text not null,
  source               text not null,
  source_revision_id   text,
  fetched_at           timestamptz not null default now(),
  check (pet_id is not null or pet_slug_snapshot is not null)
);

-- Postgres doesn't support a `unique` on a `coalesce` expression directly,
-- so we use two partial unique indexes: one for resolved pets (pet_id set)
-- and one for unresolved pets (only the snapshot slug set). Together they
-- guarantee no duplicates per (egg, pet-or-slug, source).
create unique index if not exists egg_hatch_pets_unique_resolved
  on public.egg_hatch_pets (egg_id, pet_id, source)
  where pet_id is not null;

create unique index if not exists egg_hatch_pets_unique_unresolved
  on public.egg_hatch_pets (egg_id, pet_slug_snapshot, source)
  where pet_id is null;

create index if not exists egg_hatch_pets_egg_idx on public.egg_hatch_pets (egg_id);
create index if not exists egg_hatch_pets_pet_idx on public.egg_hatch_pets (pet_id);
