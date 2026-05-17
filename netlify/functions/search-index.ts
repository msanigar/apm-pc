import type { Handler } from "@netlify/functions";
import { buildMockSearchIndex, loadSearchIndex } from "../../src/server/repo";
import { hasSupabaseAdmin } from "../../src/server/supabase";
import { json, serverError } from "./_response";

/**
 * GET /api/search-index
 *
 * Returns the compact dataset the client-side Fuse.js index is built from.
 * If Supabase is configured we read from there; otherwise we fall back to the
 * in-memory mock fixtures so the dev experience works out of the box.
 */
export const handler: Handler = async () => {
  try {
    const items = hasSupabaseAdmin()
      ? await loadSearchIndex()
      : buildMockSearchIndex();
    return json({
      generatedAt: new Date().toISOString(),
      items,
    });
  } catch (err) {
    return serverError(err);
  }
};
