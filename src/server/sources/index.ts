import { ALL_MOCK_ADAPTERS } from "./mockAdapters";
import { buildAmverseAdapters } from "./amverse";
import { buildAmtvAdapter } from "./adoptMeTradingValues";
import { buildGithubAdapters } from "./githubStaticDataset";
import type { SourceAdapter } from "./types";

/**
 * Build the set of enabled adapters for this run.
 *
 * Configuration:
 *
 *   - `VALUE_SOURCE_ADAPTERS`  — comma-separated whitelist of adapter names.
 *                                Unset: enable all "default-on" adapters.
 *                                Set to `mock-only`: just the 3 mock adapters.
 *
 *   - Per-source on/off env vars (any truthy value enables):
 *       ENABLE_AMVERSE                  → AMVerse (two logical sources)
 *       ENABLE_ADOPT_ME_TRADING_VALUES  → adoptmetradingvalues.org
 *       ENABLE_AMTV_LEGACY_MIRROR       → also pull adoptmetradingvalues.com
 *       ENABLE_GITHUB_DATASET           → shabbl3/gizmo.values
 *       ENABLE_GITHUB_IRONBABA          → ironbabatekkral/adoptme-values
 *       ENABLE_GITHUB_HIGH_TIER         → Roblox-Services/High-Tier-Adopt-Me-Values
 *
 * Defaults:
 *   In production we keep real adapters DISABLED until the operator has
 *   confirmed each source's ToS. The mock adapters are always available so
 *   the rest of the pipeline can be exercised end-to-end.
 */

function isEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function buildAllAdapters(env: Record<string, string | undefined>): SourceAdapter[] {
  const adapters: SourceAdapter[] = [...ALL_MOCK_ADAPTERS];

  if (isEnabled(env.ENABLE_AMVERSE)) {
    adapters.push(...buildAmverseAdapters({ enabled: true }));
  }

  if (isEnabled(env.ENABLE_ADOPT_ME_TRADING_VALUES)) {
    adapters.push(
      ...buildAmtvAdapter({
        enabled: true,
        enableLegacyMirror: isEnabled(env.ENABLE_AMTV_LEGACY_MIRROR),
      })
    );
  }

  if (isEnabled(env.ENABLE_GITHUB_DATASET)) {
    adapters.push(
      ...buildGithubAdapters({
        enabled: true,
        enableIronbaba: isEnabled(env.ENABLE_GITHUB_IRONBABA),
        enableHighTier: isEnabled(env.ENABLE_GITHUB_HIGH_TIER),
      })
    );
  }

  return adapters;
}

export function getEnabledAdapters(
  env: Record<string, string | undefined> = process.env
): SourceAdapter[] {
  const all = buildAllAdapters(env);

  const raw = env.VALUE_SOURCE_ADAPTERS?.trim();
  if (!raw) return all;

  if (raw.toLowerCase() === "mock-only") return ALL_MOCK_ADAPTERS;

  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const byName = new Map(all.map((a) => [a.name, a] as const));
  const out: SourceAdapter[] = [];
  for (const name of requested) {
    const adapter = byName.get(name);
    if (adapter) out.push(adapter);
    else console.warn(`[sources] Unknown adapter "${name}" — skipping`);
  }
  return out.length > 0 ? out : ALL_MOCK_ADAPTERS;
}

export type { SourceAdapter } from "./types";
