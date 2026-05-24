-- pet_acquisitions     — non-egg acquisition records for pets (events,
--                         Robux purchases, gamepass, etc.)
-- item_contents        — what's inside a box / gift / multi-item bundle
--
-- Both tables mirror the egg_hatch_* pattern:
--   - FK to items with on-delete cascade
--   - source / source_revision_id / fetched_at for audit + dedup
--   - "slug snapshot" fallback for references the catalog hasn't seen yet
--   - replace-style sync (transactional delete + insert per source/parent)

create table if not exists public.pet_acquisitions (
  id                   uuid primary key default gen_random_uuid(),
  pet_id               uuid not null references public.items (id) on delete cascade,
  -- Kind of acquisition: how the pet entered the player's inventory.
  -- 'event'   → time-limited update/event (Halloween, Christmas, …)
  -- 'robux'   → direct Robux purchase from the in-game shop / gamepass
  -- 'paid'    → in-game currency purchase (candy / gingerbread / bucks)
  -- 'task'    → task-board / age-up / quest reward
  -- 'gift'    → free reward (e.g. login gifts, daily login)
  -- 'other'   → catch-all for things we couldn't classify confidently
  kind                 text not null,
  event_name           text,
  event_year           int,
  currency             text,                    -- robux | candy | gingerbread | bucks | …
  cost                 numeric,                 -- nullable; matches the currency
  retired              boolean default false,   -- pet is no longer obtainable
  released_at          date,                    -- best-effort from prose
  notes                text,                    -- free-text catch-all
  source               text not null,
  source_revision_id   text,
  fetched_at           timestamptz not null default now()
);

-- One acquisition per (pet, kind, event_name, source) — repeated entries
-- across syncs upsert in place; a pet can legitimately have multiple
-- acquisitions (e.g. retired pets re-released later).
create unique index if not exists pet_acquisitions_unique_by_event
  on public.pet_acquisitions (pet_id, kind, coalesce(event_name, ''), source);

create index if not exists pet_acquisitions_pet_idx
  on public.pet_acquisitions (pet_id);
create index if not exists pet_acquisitions_event_idx
  on public.pet_acquisitions (event_name)
  where event_name is not null;

create table if not exists public.item_contents (
  id                       uuid primary key default gen_random_uuid(),
  container_id             uuid not null references public.items (id) on delete cascade,
  contained_item_id        uuid references public.items (id) on delete cascade,
  contained_slug_snapshot  text,
  contained_display_name   text,
  rarity                   text,                     -- common/uncommon/rare/...
  category_hint            text,                     -- pet/toy/accessory/...
  drop_chance              numeric(5,2),             -- nullable % (per-rarity, not per-item, in our source)
  quantity                 int default 1,
  source                   text not null,
  source_revision_id       text,
  fetched_at               timestamptz not null default now(),
  check (contained_item_id is not null or contained_slug_snapshot is not null)
);

-- Same split-unique trick as egg_hatch_pets: one index for resolved items,
-- one for unresolved snapshot rows.
create unique index if not exists item_contents_unique_resolved
  on public.item_contents (container_id, contained_item_id, source)
  where contained_item_id is not null;

create unique index if not exists item_contents_unique_unresolved
  on public.item_contents (container_id, contained_slug_snapshot, source)
  where contained_item_id is null;

create index if not exists item_contents_container_idx
  on public.item_contents (container_id);
create index if not exists item_contents_item_idx
  on public.item_contents (contained_item_id);

-- RLS: public read; writes only via service role from the sync job.
alter table public.pet_acquisitions enable row level security;
alter table public.item_contents enable row level security;

drop policy if exists "public read pet_acquisitions" on public.pet_acquisitions;
create policy "public read pet_acquisitions" on public.pet_acquisitions
  for select using (true);

drop policy if exists "public read item_contents" on public.item_contents;
create policy "public read item_contents" on public.item_contents
  for select using (true);
