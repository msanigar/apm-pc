#!/usr/bin/env tsx
/**
 * Run the daily sync from the command line.
 *
 *   npm run sync:local
 *
 * Behaviour:
 *   - Loads `.env` automatically (when present).
 *   - If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, writes to Supabase.
 *   - Otherwise runs in dry-run mode and just prints what it would have done.
 */
import "dotenv/config";
import { syncValues } from "../src/server/syncValues";

async function main() {
  const report = await syncValues();
  console.log("Sync report:");
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "failed" || report.status === "rejected") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
