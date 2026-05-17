#!/usr/bin/env tsx
/**
 * Preflight: verifies that the local environment is wired correctly.
 *
 *   npm run preflight
 *
 * Checks (in order):
 *
 *   1. .env file loads.
 *   2. Required env vars are present.
 *   3. Supabase REST endpoint reachable with the service role key.
 *   4. All 7 schema tables exist (no migration drift).
 *   5. Mock adapters return values.
 *   6. (Optional) Real adapters can be reached if their ENABLE_* flag is on.
 *
 * Exits 0 on success, 1 on any hard failure. Soft warnings keep the exit
 * code at 0 but are surfaced clearly.
 */
import "dotenv/config";
import { requireSupabaseAdmin, hasSupabaseAdmin } from "../src/server/supabase";
import { getEnabledAdapters } from "../src/server/sources";

type CheckResult = {
  name: string;
  ok: boolean;
  detail?: string;
  warn?: boolean;
};

const checks: CheckResult[] = [];

function record(name: string, ok: boolean, detail?: string, warn = false) {
  checks.push({ name, ok, detail, warn });
}

async function checkEnv(): Promise<boolean> {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length === 0) {
    record("env vars present", true, required.join(", "));
    return true;
  }
  record("env vars present", false, `missing: ${missing.join(", ")}`);
  return false;
}

async function checkSupabaseReachable(): Promise<boolean> {
  if (!hasSupabaseAdmin()) {
    record("supabase reachable", false, "client not configured");
    return false;
  }
  try {
    const db = requireSupabaseAdmin();
    // `count: "exact", head: true` runs a HEAD request — no rows pulled.
    const { error } = await db
      .from("items")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    record("supabase reachable", true);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("supabase reachable", false, message);
    return false;
  }
}

const EXPECTED_TABLES = [
  "items",
  "item_variants",
  "source_values",
  "aggregated_values",
  "import_runs",
  "import_validation_issues",
  "item_images",
];

async function checkSchema(): Promise<boolean> {
  const db = requireSupabaseAdmin();
  let allOk = true;
  for (const table of EXPECTED_TABLES) {
    try {
      const { error } = await db
        .from(table)
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      record(`table: ${table}`, true);
    } catch (err) {
      allOk = false;
      const message = err instanceof Error ? err.message : String(err);
      record(`table: ${table}`, false, message);
    }
  }
  return allOk;
}

async function checkMockAdapters(): Promise<boolean> {
  process.env.VALUE_SOURCE_ADAPTERS = "mock-only";
  const adapters = getEnabledAdapters();
  delete process.env.VALUE_SOURCE_ADAPTERS;
  if (adapters.length === 0) {
    record("mock adapters", false, "no mock adapters registered");
    return false;
  }
  let total = 0;
  for (const a of adapters) {
    const values = await a.fetchValues();
    total += values.length;
  }
  record("mock adapters", total > 0, `${adapters.length} adapters, ${total} raw values`);
  return total > 0;
}

async function checkConfiguredRealAdapters(): Promise<void> {
  const flagToHumanName: Record<string, string> = {
    ENABLE_AMVERSE: "amverse",
    ENABLE_ADOPT_ME_TRADING_VALUES: "adoptmetradingvalues",
    ENABLE_GITHUB_DATASET: "github_ironbabatekkral",
  };
  for (const [flag, label] of Object.entries(flagToHumanName)) {
    if (!process.env[flag]) continue;
    const adapters = getEnabledAdapters().filter((a) =>
      a.name.startsWith(label)
    );
    if (adapters.length === 0) {
      record(`real adapter: ${label}`, false, `${flag} set but no adapter registered`);
      continue;
    }
    let total = 0;
    let anyOk = false;
    for (const a of adapters) {
      const values = await a.fetchValues();
      total += values.length;
      if (values.length > 0) anyOk = true;
    }
    record(
      `real adapter: ${label}`,
      anyOk,
      `${adapters.length} adapters, ${total} raw values`,
      !anyOk // soft-warn rather than hard-fail (sites change)
    );
  }
}

function print() {
  console.log("\nPreflight results:\n");
  for (const c of checks) {
    const status = c.ok ? "✓" : c.warn ? "!" : "✗";
    const detail = c.detail ? `  — ${c.detail}` : "";
    console.log(`  ${status} ${c.name}${detail}`);
  }
  const hardFails = checks.filter((c) => !c.ok && !c.warn);
  if (hardFails.length > 0) {
    console.log(`\n${hardFails.length} check(s) failed.\n`);
  } else {
    console.log("\nAll required checks passed.\n");
  }
  process.exitCode = hardFails.length > 0 ? 1 : 0;
}

(async () => {
  const envOk = await checkEnv();
  if (!envOk) return print();

  const reachable = await checkSupabaseReachable();
  if (!reachable) return print();

  await checkSchema();
  await checkMockAdapters();
  await checkConfiguredRealAdapters();
  print();
})().catch((err) => {
  console.error("Preflight crashed:", err);
  process.exit(1);
});
