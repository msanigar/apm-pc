import type { AggregatedVariantValue, ItemCategory } from "@shared/types";
import { VARIANT_LABELS, variantsForCategory } from "@shared/variants";
import {
  confidenceColorClass,
  confidenceLabel,
  formatRp,
  valueStatusLabel,
} from "@/lib/format";

type Props = {
  category: ItemCategory;
  values: AggregatedVariantValue[];
};

export function VariantValueTable({ category, values }: Props) {
  const valueByVariant = new Map<string, AggregatedVariantValue>();
  for (const v of values) valueByVariant.set(v.variant, v);

  const orderedVariants = variantsForCategory(category);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/50">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-950/40 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">Variant</th>
            <th className="px-4 py-3 text-right font-medium">Value</th>
            <th className="px-4 py-3 text-right font-medium">Sources</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {orderedVariants.map((variant) => {
            const v = valueByVariant.get(variant);
            return (
              <tr key={variant} className="hover:bg-slate-900/60">
                <td className="px-4 py-3 text-slate-200">
                  {VARIANT_LABELS[variant]}
                </td>
                <td className="px-4 py-3 text-right text-white tabular-nums">
                  {v ? formatRp(v.valueRp) : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                  {v ? `${v.sourceCount}` : "—"}
                </td>
                <td className="px-4 py-3 text-xs">
                  {v ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={confidenceColorClass(v.confidence)}>
                        {confidenceLabel(v.confidence)}
                      </span>
                      <span className="text-slate-400">
                        {valueStatusLabel(v)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-500">No data yet</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
