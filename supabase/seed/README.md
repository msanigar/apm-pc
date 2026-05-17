# Supabase seed data

The MVP doesn't ship with real seed data on purpose — the daily scheduled
function (`netlify/functions/sync-values.ts`) is the canonical way to populate
the database.

To get something useful in the database locally:

1. Apply the migration in `supabase/migrations/`.
2. From the project root, run `npm run sync:local`. That invokes the same sync
   pipeline the Netlify Scheduled Function uses, against the mock adapters,
   writing to whatever Supabase instance your env vars point at.

If you'd rather see the UI without touching Supabase at all, the dev API
functions fall back to in-memory mock data when the Supabase env vars are not
set — `npm run dev:netlify` will work out of the box.
