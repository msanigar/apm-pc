import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client (uses the service role key). Never expose this
 * client or its key to the browser. Always import from here inside a Netlify
 * Function, never from frontend code.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "amvc-server" } },
  });
  return cached;
}

export function requireSupabaseAdmin(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new Error(
      "Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return client;
}

export function hasSupabaseAdmin(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
