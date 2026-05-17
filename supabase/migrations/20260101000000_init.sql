-- Adopt Me Value Checker — initial schema
--
-- Tables:
--   items                       canonical pets/items
--   item_variants               which variants exist for an item
--   source_values               raw per-source per-variant values
--   aggregated_values           live aggregated value table the UI reads
--   import_runs                 audit log for the daily sync job
--   import_validation_issues    per-row issues raised during validation
--   item_images                 cached image metadata

create extension if not exists "pgcrypto";

-- ============================================================================
-- items
-- ============================================================================
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  category    text not null,
  rarity      text,
  aliases     text[] default '{}'::text[],
  image_path  text,
  is_high_tier boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists items_category_idx on public.items (category);
create index if not exists items_high_tier_idx on public.items (is_high_tier);

-- ============================================================================
-- item_variants — which (item, variant) pairs are valid
-- ============================================================================
create table if not exists public.item_variants (
  id       uuid primary key default gen_random_uuid(),
  item_id  uuid references public.items (id) on delete cascade,
  variant  text not null,
  unique (item_id, variant)
);

-- ============================================================================
-- source_values — raw per-source per-variant values
-- One row per (source, item, variant, fetched_at).
-- ============================================================================
create table if not exists public.source_values (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid references public.items (id) on delete cascade,
  variant           text not null,
  source_name       text not null,
  source_item_name  text,
  value_rp          numeric not null,
  demand            numeric,
  confidence        text,
  fetched_at        timestamptz not null default now()
);

create index if not exists source_values_item_idx
  on public.source_values (item_id, variant);
create index if not exists source_values_source_idx
  on public.source_values (source_name, fetched_at desc);

-- ============================================================================
-- aggregated_values — what the UI actually reads
-- One row per (item, variant). Unique constraint is critical for upserts.
-- ============================================================================
create table if not exists public.aggregated_values (
  id                       uuid primary key default gen_random_uuid(),
  item_id                  uuid references public.items (id) on delete cascade,
  variant                  text not null,
  value_rp                 numeric not null,
  min_rp                   numeric,
  max_rp                   numeric,
  source_count             int not null,
  confidence               text not null,
  is_suspicious            boolean default false,
  last_accepted_at         timestamptz,
  last_candidate_value_rp  numeric,
  last_candidate_at        timestamptz,
  calculated_at            timestamptz not null default now(),
  unique (item_id, variant)
);

create index if not exists aggregated_values_item_idx
  on public.aggregated_values (item_id);

-- ============================================================================
-- import_runs — audit log for each scheduled sync
-- status ∈ ('running','promoted','partial','rejected','failed')
-- ============================================================================
create table if not exists public.import_runs (
  id                uuid primary key default gen_random_uuid(),
  started_at        timestamptz default now(),
  completed_at      timestamptz,
  status            text not null,
  source_count      int,
  item_count        int,
  promoted_count    int default 0,
  held_back_count   int default 0,
  suspicious_count  int default 0,
  missing_count     int default 0,
  notes             text
);

create index if not exists import_runs_started_idx
  on public.import_runs (started_at desc);

-- ============================================================================
-- import_validation_issues — per-row issues raised during a sync
-- ============================================================================
create table if not exists public.import_validation_issues (
  id              uuid primary key default gen_random_uuid(),
  import_run_id   uuid references public.import_runs (id) on delete cascade,
  item_id         uuid references public.items (id),
  variant         text,
  issue_type      text not null,
  old_value_rp    numeric,
  new_value_rp    numeric,
  percent_change  numeric,
  severity        text not null,
  created_at      timestamptz default now()
);

create index if not exists ivi_run_idx on public.import_validation_issues (import_run_id);

-- ============================================================================
-- item_images — cached image metadata (binary lives in Supabase Storage)
-- ============================================================================
create table if not exists public.item_images (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid references public.items (id) on delete cascade,
  source_name       text,
  source_image_url  text,
  storage_path      text not null,
  width             int,
  height            int,
  checksum          text,
  fetched_at        timestamptz default now()
);

create index if not exists item_images_item_idx on public.item_images (item_id);

-- ============================================================================
-- RLS
-- The anon key has read-only access. All writes happen via the service role
-- key inside Netlify Functions, which bypasses RLS.
-- ============================================================================
alter table public.items enable row level security;
alter table public.item_variants enable row level security;
alter table public.aggregated_values enable row level security;
alter table public.item_images enable row level security;
alter table public.import_runs enable row level security;
alter table public.import_validation_issues enable row level security;
alter table public.source_values enable row level security;

drop policy if exists "public read items" on public.items;
create policy "public read items" on public.items
  for select using (true);

drop policy if exists "public read item_variants" on public.item_variants;
create policy "public read item_variants" on public.item_variants
  for select using (true);

drop policy if exists "public read aggregated_values" on public.aggregated_values;
create policy "public read aggregated_values" on public.aggregated_values
  for select using (true);

drop policy if exists "public read item_images" on public.item_images;
create policy "public read item_images" on public.item_images
  for select using (true);

drop policy if exists "public read import_runs" on public.import_runs;
create policy "public read import_runs" on public.import_runs
  for select using (true);
