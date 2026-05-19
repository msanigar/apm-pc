import type { Handler } from "@netlify/functions";
import { getSupabaseAdmin } from "../../src/server/supabase";
import { badRequest, json, serverError } from "./_response";

/**
 * POST /api/short
 *
 * Body: `{ "query": "l=...&r=..." }`
 *
 * Persists the query string against an unguessable short code and returns
 * `{ code, url }` where `url` is the fully-qualified short link the caller
 * can drop into Discord / X / iMessage / wherever.
 *
 * The Trade page calls this on "Copy link"; if anything fails it falls
 * back to copying the long inline-encoded URL so the user never gets a
 * broken share flow.
 */

// 32-char base32-style alphabet that avoids confusing pairs (0/O, 1/l,
// 2/Z). 8 characters → ~1.1 trillion combinations, collisions effectively
// never happen at our scale.
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;
const MAX_QUERY_LENGTH = 4_000; // generous — plenty for an 18×18 trade
const MAX_ALLOCATION_RETRIES = 6;

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  let body: { query?: unknown };
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return badRequest("Invalid JSON body");
  }

  const query =
    typeof body.query === "string" ? body.query.trim().replace(/^\?/, "") : "";
  if (!query) return badRequest("Missing query");
  if (query.length > MAX_QUERY_LENGTH) return badRequest("Query too long");
  // Very light shape check — the trade encoder always produces `l=` or
  // `r=` (or both). Anything wildly off-shape gets a polite 400 so this
  // endpoint can't be abused as a generic key/value store.
  if (!/(^|&)(l|r)=/.test(query)) {
    return badRequest("Unsupported query shape");
  }

  const db = getSupabaseAdmin();
  if (!db) {
    return serverError(new Error("Supabase admin not configured"));
  }

  try {
    let code: string | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ALLOCATION_RETRIES; attempt++) {
      const candidate = generateCode();
      const { error } = await db
        .from("trade_snapshots")
        .insert({ code: candidate, query })
        .select("code")
        .single();
      if (!error) {
        code = candidate;
        break;
      }
      // 23505 = unique_violation — try again with a fresh code.
      if ((error as { code?: string }).code === "23505") {
        lastError = error;
        continue;
      }
      throw error;
    }
    if (!code) {
      throw lastError ?? new Error("Could not allocate a short code");
    }

    const origin = event.headers?.["x-forwarded-host"]
      ? `https://${event.headers["x-forwarded-host"]}`
      : event.headers?.host
        ? `https://${event.headers.host}`
        : "";
    const url = origin ? `${origin}/s/${code}` : `/s/${code}`;

    return json({ code, url });
  } catch (err) {
    return serverError(err);
  }
};
