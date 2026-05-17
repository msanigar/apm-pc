import type { Handler } from "@netlify/functions";
import { syncValues } from "../../src/server/syncValues";
import { json, serverError } from "./_response";

/**
 * Scheduled Netlify Function. Cron is configured in netlify.toml under
 * `[functions."sync-values"].schedule`.
 *
 * Also reachable on-demand at /.netlify/functions/sync-values for manual
 * re-runs (useful when debugging a botched import).
 */
export const handler: Handler = async () => {
  try {
    const report = await syncValues();
    return json({ ok: true, report });
  } catch (err) {
    console.error("[sync-values] fatal error", err);
    return serverError(err);
  }
};
