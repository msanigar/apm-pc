import type { SearchIndexItem } from "@shared/types";
import { VARIANT_SHORT_LABELS } from "@shared/variants";
import { formatRp } from "@/lib/format";
import { getCategoryTheme, getVariantTheme } from "@/lib/theme";
import { SparkleIcon, XIcon } from "@/components/icons";
import type { TradeSlot as TradeSlotType } from "@/lib/trade";

type FilledProps = {
  slot: TradeSlotType;
  item: SearchIndexItem | undefined;
  onRemove: () => void;
};

type EmptyProps = {
  onAdd: () => void;
  disabled?: boolean;
};

export function FilledTradeSlot({ slot, item, onRemove }: FilledProps) {
  const value = item?.values[slot.variant]?.valueRp ?? null;
  const tint = getVariantTheme(slot.variant);
  const categoryTheme = getCategoryTheme(item?.category ?? "other");
  const isStale = !item;

  return (
    <div
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border-2 border-white p-2.5 shadow-sm transition ${
        isStale ? "bg-slate-100" : `${tint.className} ${tint.glowClass ?? ""}`
      }`}
    >
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove from trade"
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white/80 text-slate-500 shadow-sm transition hover:scale-110 hover:bg-rose-100 hover:text-rose-600 active:scale-95"
      >
        <XIcon size={12} />
      </button>

      <div className="flex items-start gap-2">
        {item?.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            className="h-9 w-9 shrink-0 rounded-xl border border-white bg-slate-50 object-cover shadow-sm"
          />
        ) : (
          <div
            aria-hidden
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-sm ${
              isStale ? "bg-slate-200 text-slate-400" : categoryTheme.iconBgClass
            }`}
          >
            <categoryTheme.Icon size={16} />
          </div>
        )}
        <div className="min-w-0 flex-1 pr-5">
          <p className="truncate text-[11px] font-extrabold leading-tight text-slate-900">
            {item?.name ?? "Item missing"}
            {item?.isHighTier && (
              <span className="ml-1 inline-flex h-3 items-center text-sunny-500 animate-sparkle">
                <SparkleIcon size={10} />
              </span>
            )}
          </p>
          <span className="mt-0.5 inline-flex items-center rounded-md bg-white/80 px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-700 shadow-sm">
            {VARIANT_SHORT_LABELS[slot.variant]}
          </span>
        </div>
      </div>

      <div className="mt-auto pt-1.5 text-right">
        <span className="text-xs font-black tabular-nums">
          {isStale ? "—" : formatRp(value)}
        </span>
      </div>
    </div>
  );
}

export function EmptyTradeSlot({ onAdd, disabled }: EmptyProps) {
  if (disabled) {
    return (
      <div
        aria-hidden
        className="grid h-full place-items-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/40 p-3 text-center"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Max 18
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      className="group grid h-full w-full place-items-center rounded-2xl border-2 border-dashed border-brand-200 bg-white/60 p-3 text-center transition hover:-translate-y-0.5 hover:border-brand-400 hover:bg-white hover:shadow-md active:scale-[0.98]"
    >
      <span className="text-xl font-black text-brand-300 transition group-hover:text-brand-500">
        +
      </span>
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 group-hover:text-brand-500">
        Add item
      </span>
    </button>
  );
}
