import { ALL_MOCK_ADAPTERS } from "./mockAdapters";
import type { SourceAdapter } from "./types";

/**
 * Build the set of enabled adapters for this run.
 *
 * Configuration:
 *   - `VALUE_SOURCE_ADAPTERS=mock-a,mock-c` enables only those adapters.
 *   - Unset means all built-in adapters.
 *
 * Real adapters (a Trading Values site, a community GitHub dataset, etc.) get
 * registered in the `REGISTRY` map below as they're added.
 */
const REGISTRY: Record<string, SourceAdapter> = Object.fromEntries(
  ALL_MOCK_ADAPTERS.map((a) => [a.name, a])
);

export function getEnabledAdapters(
  env: Record<string, string | undefined> = process.env
): SourceAdapter[] {
  const raw = env.VALUE_SOURCE_ADAPTERS?.trim();
  if (!raw) return ALL_MOCK_ADAPTERS;
  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const adapters: SourceAdapter[] = [];
  for (const name of requested) {
    const adapter = REGISTRY[name];
    if (adapter) adapters.push(adapter);
    else console.warn(`[sources] Unknown adapter "${name}" — skipping`);
  }
  return adapters.length > 0 ? adapters : ALL_MOCK_ADAPTERS;
}

export type { SourceAdapter } from "./types";
