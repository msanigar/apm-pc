import type { SearchIndexItem } from "@shared/types";
import { formatRp } from "@/lib/format";
import {
  canAddSlot,
  MAX_SLOTS_PER_SIDE,
  sideTotals,
  type TradeSide as TradeSideType,
} from "@/lib/trade";
import { EmptyTradeSlot, FilledTradeSlot } from "./TradeSlot";

type Props = {
  side: TradeSideType;
  label: string;
  accentClass: string;
  bySlug: Map<string, SearchIndexItem>;
  onAddSlot: () => void;
  onRemoveAt: (index: number) => void;
  onClear: () => void;
};

/**
 * One side of the trade window: header, 3-column grid of up to 18 slot
 * tiles, and a totals footer. Always renders an "add" placeholder as the
 * next available slot until the cap is reached.
 */
export function TradeSide({
  side,
  label,
  accentClass,
  bySlug,
  onAddSlot,
  onRemoveAt,
  onClear,
}: Props) {
  const totals = sideTotals(side, bySlug);
  const canAdd = canAddSlot(side);
  // Pad the visible grid out to a multiple of 3 with placeholder cells so it
  // always looks tidy. We only render the *first* placeholder as interactive
  // ("+ Add"); the rest are aria-hidden filler.
  const visualSlots = Math.min(
    MAX_SLOTS_PER_SIDE,
    Math.max(side.slots.length + (canAdd ? 1 : 0), 6)
  );
  const placeholderStart = side.slots.length;
  const cells = Array.from({ length: visualSlots }, (_, i) => i);

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur-sm sm:p-4">
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className={`text-sm font-extrabold tracking-tight ${accentClass}`}>{label}</h2>
        <button
          type="button"
          onClick={onClear}
          disabled={side.slots.length === 0}
          className="rounded-full px-2.5 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          Clear
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {cells.map((i) => {
          if (i < side.slots.length) {
            const slot = side.slots[i];
            const item = bySlug.get(slot.itemSlug);
            return (
              <div key={`s-${i}`} className="aspect-square">
                <FilledTradeSlot
                  slot={slot}
                  item={item}
                  onRemove={() => onRemoveAt(i)}
                />
              </div>
            );
          }
          if (i === placeholderStart) {
            return (
              <div key="add" className="aspect-square">
                <EmptyTradeSlot onAdd={onAddSlot} disabled={!canAdd} />
              </div>
            );
          }
          return (
            <div
              key={`p-${i}`}
              aria-hidden
              className="aspect-square rounded-2xl border-2 border-dashed border-slate-100 bg-white/30"
            />
          );
        })}
      </div>

      <footer className="flex items-baseline justify-between gap-2 px-1">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {side.slots.length}/{MAX_SLOTS_PER_SIDE} items
          {totals.unknownCount > 0 && (
            <span
              className="ml-2 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-700"
              title={`${totals.unknownCount} item(s) have no value data yet — the total is a lower bound.`}
            >
              {totals.unknownCount} unknown
            </span>
          )}
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Total
          </p>
          <p className="text-lg font-black tabular-nums text-slate-900">
            {totals.unknownCount > 0 && "≥ "}
            {formatRp(totals.knownRp)}
          </p>
        </div>
      </footer>
    </section>
  );
}
