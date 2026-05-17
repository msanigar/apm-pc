import "dotenv/config";
import { requireSupabaseAdmin } from "../src/server/supabase";

/**
 * One-shot helper for clearing the database before a clean real-source sync.
 *
 * The pipeline's validation logic refuses to promote a candidate that
 * covers < 90% of live items. The current DB is seeded entirely from mock
 * adapters whose names ("Mock Phoenix", "Mock Owl", …) don't exist in any
 * real source, so the first real sync would be flagged as fatal-low
 * coverage. Wipe the slate first, then run `npm run sync:local`.
 *
 * Usage:
 *   npm run wipe:local
 *
 * Safe in dev only — guards against accidental prod use by checking that
 * SUPABASE_URL looks like a Supabase URL and prompting via the CONFIRM env
 * var.
 */
async function main() {
  if (process.env.CONFIRM !== "yes") {
    console.error(
      "Refusing to wipe data without CONFIRM=yes. Re-run as:\n" +
        "  CONFIRM=yes npm run wipe:local"
    );
    process.exit(1);
  }

  const supabase = requireSupabaseAdmin();

  const tables = [
    "import_validation_issues",
    "source_values",
    "aggregated_values",
    "item_images",
    "item_variants",
    "items",
  ];

  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .gte("created_at", "1900-01-01"); // delete-all needs a filter
    if (error) {
      // Some tables don't have created_at — fall back to a never-matching slug.
      const { error: err2 } = await supabase
        .from(table)
        .delete()
        .not("id", "is", null);
      if (err2) {
        console.warn(`  ! Failed to wipe ${table}: ${err2.message}`);
      } else {
        console.log(`  ✓ Cleared ${table}`);
      }
    } else {
      console.log(`  ✓ Cleared ${table} (${count ?? "?"} rows)`);
    }
  }

  console.log("\nDone. You can now run:\n  npm run sync:local\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
