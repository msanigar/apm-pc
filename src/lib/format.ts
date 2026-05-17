import type { AggregatedVariantValue, Confidence } from "@shared/types";

export function formatRp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M RP`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K RP`;
  return `${formatNumber(value)} RP`;
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - Date.now();
  const seconds = Math.round(diffMs / 1000);
  const abs = Math.abs(seconds);

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return formatter.format(seconds, "second");
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 604_800) return formatter.format(Math.round(seconds / 86_400), "day");
  return formatter.format(Math.round(seconds / 604_800), "week");
}

/**
 * Produce the short, friendly status label shown next to a value.
 */
export function valueStatusLabel(v: AggregatedVariantValue, now = new Date()): string {
  if (v.isSuspicious) return "Held due to unusual source movement";
  const accepted = v.lastAcceptedAt ? new Date(v.lastAcceptedAt) : null;
  if (accepted) {
    const days = (now.getTime() - accepted.getTime()) / 86_400_000;
    if (days < 1) return "Updated today";
    if (days < 2) return "Last confirmed yesterday";
    if (days < 7) return `Last confirmed ${Math.floor(days)}d ago`;
    return "Stale — older than a week";
  }
  return "Stable";
}

export function confidenceLabel(c: Confidence): string {
  switch (c) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
  }
}

export function confidenceColorClass(c: Confidence): string {
  switch (c) {
    case "high":
      return "text-emerald-300";
    case "medium":
      return "text-amber-300";
    case "low":
      return "text-rose-300";
  }
}
