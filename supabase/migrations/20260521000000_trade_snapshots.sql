-- trade_snapshots — short-URL backing store for shareable trade comparisons.
--
-- The /trade page can serialise its full state into a query string
-- (?l=...&r=...). For long trades that string becomes too unwieldy for
-- Discord / X / iMessage to handle nicely, so we mint a short code that
-- the GET /s/:code function expands back into the full /trade URL.
--
-- The query string is stored as opaque text; we don't need to parse it
-- server-side. If the encoding ever changes, old codes still resolve
-- because the client decodes them on the receiving end.

create table if not exists public.trade_snapshots (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  query       text not null,
  created_at  timestamptz not null default now(),
  view_count  int not null default 0
);

create index if not exists trade_snapshots_code_idx
  on public.trade_snapshots (code);

-- Anon role gets SELECT so direct GET /s/:code lookups work via the
-- public REST API as well (defence in depth — primary path goes through
-- the service-role-authenticated function). Writes only happen via the
-- service role from `short-create`.
alter table public.trade_snapshots enable row level security;

drop policy if exists "public read trade_snapshots" on public.trade_snapshots;
create policy "public read trade_snapshots" on public.trade_snapshots
  for select using (true);
