import type { Handler } from "@netlify/functions";
import { hasSupabaseAdmin } from "../../src/server/supabase";
import { json, serverError } from "./_response";

/**
 * Health / diagnostic endpoint.
 *
 * Returns whatever the function process actually sees at runtime:
 *   - `supabaseConfigured` — the same boolean repo.ts gates on
 *   - `envVars` — for each name we care about: whether it is defined, its
 *     length, and (for URLs only) a fingerprint of the form
 *     `<first-12-chars>...<last-6-chars>`.
 *
 * We never echo secret values. Lengths and a URL fingerprint are enough to
 * spot the common failure modes:
 *   • missing entirely (`defined: false`)
 *   • empty string ("`length: 0`")
 *   • wrong project (`fingerprint` doesn't match the expected URL)
 *   • surrounding whitespace (`length` is bigger than the real value)
 *   • CRLF / quoting damage (`length` is way bigger than expected)
 *
 * Safe to leave on long-term; everyone can ping `/health` to confirm a deploy
 * is wired up correctly.
 */
const EXPECTED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_IMAGE_BUCKET",
  "VALUE_SOURCE_ADAPTERS",
  "ENABLE_AMVERSE",
  "ENABLE_ADOPT_ME_TRADING_VALUES",
  "ENABLE_GITHUB_DATASET",
] as const;

function summariseVar(name: string) {
  const raw = process.env[name];
  if (raw == null) return { defined: false };
  // Length and a small "fingerprint" — URL-shaped values get a partial echo
  // so the team can confirm the value is pointing at the right project, but
  // secrets (JWTs etc.) only ever reveal their length.
  const isUrlShaped = raw.startsWith("http://") || raw.startsWith("https://");
  return {
    defined: true,
    length: raw.length,
    ...(isUrlShaped
      ? {
          fingerprint:
            raw.length > 22
              ? `${raw.slice(0, 12)}…${raw.slice(-6)}`
              : `${raw.slice(0, 8)}…`,
        }
      : {}),
    ...(raw !== raw.trim()
      ? { hasSurroundingWhitespace: true }
      : {}),
  };
}

export const handler: Handler = async () => {
  try {
    const envVars: Record<string, ReturnType<typeof summariseVar>> = {};
    for (const name of EXPECTED_VARS) envVars[name] = summariseVar(name);

    return json({
      ok: true,
      timestamp: new Date().toISOString(),
      runtime: "netlify-functions",
      supabaseConfigured: hasSupabaseAdmin(),
      envVars,
    });
  } catch (err) {
    return serverError(err);
  }
};
