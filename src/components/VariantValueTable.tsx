import type { AggregatedVariantValue, ItemCategory, Variant } from "@shared/types";
import { VARIANT_LABELS, VARIANT_SHORT_LABELS, variantsForCategory } from "@shared/variants";
import {
  confidenceLabel,
  formatRp,
  valueStatusLabel,
} from "@/lib/format";
import { getVariantTheme } from "@/lib/theme";

type Props = {
  category: ItemCategory;
  values: AggregatedVariantValue[];
};

export function VariantValueTable({ category, values }: Props) {
  const valueByVariant = new Map<Variant, AggregatedVariantValue>();
  for (const v of values) valueByVariant.set(v.variant, v);

  const orderedVariants = variantsForCategory(category);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {orderedVariants.map((variant) => {
        const v = valueByVariant.get(variant);
        return (
          <VariantTile
            key={variant}
            variant={variant}
            value={v}
          />
        );
      })}
    </div>
  );
}

function VariantTile({
  variant,
  value,
}: {
  variant: Variant;
  value: AggregatedVariantValue | undefined;
}) {
  const tint = getVariantTheme(variant);
  const isMissing = !value;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border-2 border-white p-4 shadow-sm transition ${
        isMissing
          ? "bg-slate-50/60 text-slate-400"
          : `${tint.className} ${tint.glowClass ?? ""}`
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider shadow-sm">
            {VARIANT_SHORT_LABELS[variant]}
          </span>
          <span className="text-xs font-bold opacity-80">
            {VARIANT_LABELS[variant]}
          </span>
        </div>
        {value && (
          <ConfidenceDot confidence={value.confidence} />
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-black tabular-nums">
          {value ? formatRp(value.valueRp) : "—"}
        </span>
        {value && value.minRp !== value.maxRp && (
          <span className="text-xs font-semibold opacity-70">
            {formatRp(value.minRp)}–{formatRp(value.maxRp)}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] font-semibold opacity-75">
        <span>
          {value
            ? `${value.sourceCount} ${value.sourceCount === 1 ? "source" : "sources"}`
            : "No data yet"}
        </span>
        {value && <span>{valueStatusLabel(value)}</span>}
      </div>

      {value && (
        <span className="sr-only">{confidenceLabel(value.confidence)}</span>
      )}
    </div>
  );
}

function ConfidenceDot({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const color =
    confidence === "high"
      ? "bg-emerald-500"
      : confidence === "medium"
        ? "bg-amber-400"
        : "bg-rose-400";
  return (
    <span
      title={`${confidence} confidence`}
      className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white ${color}`}
    />
  );
}
