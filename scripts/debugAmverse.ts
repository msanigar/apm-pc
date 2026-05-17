#!/usr/bin/env tsx
import "dotenv/config";
import { buildAmverseAdapters } from "../src/server/sources/amverse";
import { normalizeSourceValues, buildCandidateDataset } from "../src/shared/normalize";
import { toSlug } from "../src/shared/slug";

async function main() {
  const [adapter] = buildAmverseAdapters({ enabled: true });
  console.time("fetch");
  const raw = await adapter.fetchValues();
  console.timeEnd("fetch");
  console.log(`Raw rows: ${raw.length}`);

  const uniqueItems = new Set(raw.map((r) => r.sourceItemName));
  console.log(`Unique item names: ${uniqueItems.size}`);

  const normalized = normalizeSourceValues(raw);
  console.log(`Normalised rows: ${normalized.length}`);
  console.log(
    `Unique normalised slugs: ${new Set(normalized.map((r) => r.itemSlug)).size}`
  );

  const candidate = buildCandidateDataset(normalized);
  console.log(`Candidate rows: ${candidate.rows.length}`);

  // Find slug collisions: same slug, multiple distinct source names
  const collisions = new Map<string, Set<string>>();
  for (const r of raw) {
    const slug = toSlug(r.sourceItemName);
    const set = collisions.get(slug) ?? new Set<string>();
    set.add(r.sourceItemName);
    collisions.set(slug, set);
  }
  const colliding = [...collisions.entries()].filter(([, s]) => s.size > 1);
  console.log(`\nSlug collisions (top 10):`);
  for (const [slug, names] of colliding.slice(0, 10)) {
    console.log(`  ${slug}: ${[...names].join(" | ")}`);
  }
  console.log(`Total colliding slugs: ${colliding.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
