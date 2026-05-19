import type { Handler } from "@netlify/functions";
import { getSupabaseAdmin } from "../../src/server/supabase";
import { notFound, serverError } from "./_response";

/**
 * GET /s/:code
 *
 * Looks up the saved trade snapshot for the given short code and 302s
 * the browser onto `/trade?{query}`. Best-effort view counter bumps in
 * the background so we can later see which shared trades got traction.
 *
 * 404 if the code is unknown. Never throws — falls back to `notFound`
 * for any unexpected error so a malformed code can't surface a 500.
 */

const CODE_PATTERN = /^[a-z0-9]{4,12}$/;

export const handler: Handler = async (event) => {
  const rawCode = (
    event.queryStringParameters?.code ??
    event.path.split("/").pop() ??
    ""
  ).toLowerCase();
  if (!CODE_PATTERN.test(rawCode)) return notFound();

  const db = getSupabaseAdmin();
  if (!db) return serverError(new Error("Supabase admin not configured"));

  try {
    const { data, error } = await db
      .from("trade_snapshots")
      .select("id, query, view_count")
      .eq("code", rawCode)
      .maybeSingle();
    if (error) throw error;
    if (!data) return notFound();

    const row = data as { id: string; query: string; view_count: number };
    const safeQuery = row.query.startsWith("?") ? row.query.slice(1) : row.query;
    const location = `/trade?${safeQuery}`;

    // Best-effort: fire-and-forget the view counter so the redirect isn't
    // gated on a second DB roundtrip. Race conditions here are fine —
    // analytics, not authorisation.
    void db
      .from("trade_snapshots")
      .update({ view_count: row.view_count + 1 })
      .eq("id", row.id)
      .then(() => undefined, () => undefined);

    return {
      statusCode: 302,
      headers: {
        Location: location,
        "cache-control": "public, max-age=300, s-maxage=3600",
      },
      body: "",
    };
  } catch (err) {
    return serverError(err);
  }
};
