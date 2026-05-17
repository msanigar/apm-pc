import type { Handler } from "@netlify/functions";
import { getLatestImportRun } from "../../src/server/repo";
import { hasSupabaseAdmin } from "../../src/server/supabase";
import { json, serverError } from "./_response";

/**
 * GET /api/import-runs/latest
 *
 * Returns the most recent import run summary, or `null` if there isn't one
 * (e.g. brand new deploy where the schedule hasn't fired yet, or Supabase
 * isn't configured in dev).
 */
export const handler: Handler = async () => {
  try {
    if (!hasSupabaseAdmin()) return json({ run: null, supabaseConfigured: false });
    const run = await getLatestImportRun();
    return json({ run, supabaseConfigured: true });
  } catch (err) {
    return serverError(err);
  }
};
