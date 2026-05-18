import { useEffect, useMemo, useRef, useState } from "react";
import type Fuse from "fuse.js";
import type { ItemCategory, SearchIndexItem, Variant } from "@shared/types";
import { variantsForCategory, VARIANT_LABELS, VARIANT_SHORT_LABELS } from "@shared/variants";
import { parseSearchQuery } from "@shared/parseSearchQuery";
import { formatRp } from "@/lib/format";
import { getCategoryTheme, getVariantTheme } from "@/lib/theme";
import { CategoryFilter } from "@/components/CategoryFilter";
import { SearchBox } from "@/components/SearchBox";
import { XIcon } from "@/components/icons";
import type { TradeSlot } from "@/lib/trade";

type Props = {
  isOpen: boolean;
  fuse: Fuse<SearchIndexItem> | null;
  items: SearchIndexItem[];
  onPick: (slot: TradeSlot) => void;
  onClose: () => void;
};

const PAGE_SIZE = 30;

export function TradeItemPicker({ isOpen, fuse, items, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ItemCategory | null>(null);
  const [picked, setPicked] = useState<SearchIndexItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset internal state whenever the picker is reopened so the user always
  // starts on a clean search/filter.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setCategory(null);
      setPicked(null);
      setVisibleCount(PAGE_SIZE);
    }
  }, [isOpen]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, category]);

  // ESC closes the picker.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (picked) setPicked(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, picked, onClose]);

  // Prevent body scroll while the modal is open.
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const availableCategories = useMemo(() => {
    const set = new Set<ItemCategory>();
    for (const item of items) set.add(item.category);
    return set;
  }, [items]);

  const ranked = useMemo(() => {
    const parsed = parseSearchQuery(query);
    let candidates: SearchIndexItem[];
    if (!parsed.normalizedQuery) {
      candidates = items;
    } else if (!fuse) {
      candidates = [];
    } else {
      candidates = fuse
        .search(parsed.normalizedQuery, { limit: 500 })
        .map((h) => h.item);
    }
    if (category) candidates = candidates.filter((i) => i.category === category);
    if (!parsed.normalizedQuery) {
      return [...candidates].sort((a, b) => topValueOf(b) - topValueOf(a));
    }
    return candidates;
  }, [fuse, items, query, category]);

  if (!isOpen) return null;

  const visible = ranked.slice(0, visibleCount);
  const total = ranked.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick an item to add to the trade"
      className="fixed inset-0 z-30 flex items-start justify-center bg-slate-900/40 px-3 py-6 backdrop-blur-sm sm:items-center sm:py-12"
      onClick={(e) => {
        // Click on the backdrop closes; clicks inside the card don't.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-br from-brand-50 via-white to-bubble-50 px-5 py-4">
          <div>
            <h2 className="text-base font-extrabold tracking-tight text-slate-900">
              {picked ? "Pick a variant" : "Add to trade"}
            </h2>
            <p className="text-xs font-semibold text-slate-500">
              {picked
                ? "Pick which version of this pet/item to include."
                : "Search or browse — picking an item moves you to variant selection."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:scale-110 hover:bg-bubble-50 hover:text-bubble-600 active:scale-95"
          >
            <XIcon size={18} />
          </button>
        </header>

        {picked ? (
          <VariantStep
            item={picked}
            onBack={() => setPicked(null)}
            onPick={(variant) => {
              onPick({ itemSlug: picked.slug, variant });
              onClose();
            }}
          />
        ) : (
          <ItemStep
            query={query}
            setQuery={setQuery}
            category={category}
            setCategory={setCategory}
            availableCategories={availableCategories}
            visible={visible}
            total={total}
            visibleCount={visibleCount}
            onShowMore={() => setVisibleCount((n) => n + PAGE_SIZE)}
            onPick={setPicked}
          />
        )}
      </div>
    </div>
  );
}

function ItemStep({
  query,
  setQuery,
  category,
  setCategory,
  availableCategories,
  visible,
  total,
  visibleCount,
  onShowMore,
  onPick,
}: {
  query: string;
  setQuery: (q: string) => void;
  category: ItemCategory | null;
  setCategory: (c: ItemCategory | null) => void;
  availableCategories: ReadonlySet<ItemCategory>;
  visible: SearchIndexItem[];
  total: number;
  visibleCount: number;
  onShowMore: () => void;
  onPick: (item: SearchIndexItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <>
      <div className="space-y-3 border-b border-slate-100 px-5 py-4">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search any pet or item…"
          autoFocus
        />
        <div>
          <CategoryFilter
            selected={category}
            onSelect={setCategory}
            availableCategories={availableCategories}
          />
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {visible.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <p className="text-sm font-bold text-slate-600">No matches.</p>
            <p className="mt-1 text-xs text-slate-500">
              Try fewer letters or a different category.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((item) => (
              <li key={item.id}>
                <PickerRow item={item} onPick={() => onPick(item)} />
              </li>
            ))}
            {visibleCount < total && (
              <li className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={onShowMore}
                  className="rounded-full bg-slate-100 px-4 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-slate-200"
                >
                  Show {Math.min(PAGE_SIZE, total - visibleCount)} more
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}

function PickerRow({
  item,
  onPick,
}: {
  item: SearchIndexItem;
  onPick: () => void;
}) {
  const categoryTheme = getCategoryTheme(item.category);
  const top = topValueOf(item);
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex w-full items-center gap-3 rounded-2xl border border-white/60 bg-white px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md active:scale-[0.99]"
    >
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-xl border border-white bg-slate-50 object-cover"
        />
      ) : (
        <div
          aria-hidden
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${categoryTheme.iconBgClass}`}
        >
          <categoryTheme.Icon size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-slate-900">{item.name}</p>
        <p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {categoryTheme.label}
          {item.rarity ? ` · ${item.rarity}` : ""}
        </p>
      </div>
      {top > 0 && (
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold tabular-nums text-slate-700 group-hover:bg-brand-100 group-hover:text-brand-700">
          {formatRp(top)}
        </span>
      )}
    </button>
  );
}

function VariantStep({
  item,
  onBack,
  onPick,
}: {
  item: SearchIndexItem;
  onBack: () => void;
  onPick: (variant: Variant) => void;
}) {
  const variants = variantsForCategory(item.category);
  const categoryTheme = getCategoryTheme(item.category);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-3 px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-slate-200"
        >
          ← Back
        </button>
        <div className="flex min-w-0 items-center gap-2">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl border border-white bg-slate-50 object-cover"
            />
          ) : (
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${categoryTheme.iconBgClass}`}>
              <categoryTheme.Icon size={16} />
            </div>
          )}
          <p className="truncate text-sm font-extrabold text-slate-900">{item.name}</p>
        </div>
      </div>

      <div className="grid gap-2 px-4 pb-5 sm:grid-cols-2">
        {variants.map((variant) => {
          const value = item.values[variant];
          const tint = getVariantTheme(variant);
          const disabled = !value;
          return (
            <button
              key={variant}
              type="button"
              onClick={() => onPick(variant)}
              disabled={disabled && variants.length > 1}
              className={`flex items-center justify-between rounded-2xl border-2 border-white px-3 py-2.5 text-left shadow-sm transition active:scale-[0.99] ${
                disabled
                  ? "cursor-not-allowed bg-slate-50/60 text-slate-400 hover:translate-y-0"
                  : `${tint.className} hover:-translate-y-0.5 hover:shadow-md`
              }`}
              title={disabled ? "No aggregated value yet" : undefined}
            >
              <span className="flex items-baseline gap-2">
                <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider shadow-sm">
                  {VARIANT_SHORT_LABELS[variant]}
                </span>
                <span className="text-xs font-bold opacity-90">{VARIANT_LABELS[variant]}</span>
              </span>
              <span className="text-sm font-extrabold tabular-nums">
                {value ? formatRp(value.valueRp) : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function topValueOf(item: SearchIndexItem): number {
  return (
    item.values.mega_fly_ride?.valueRp ??
    item.values.mega_fly?.valueRp ??
    item.values.mega_ride?.valueRp ??
    item.values.mega?.valueRp ??
    item.values.neon_fly_ride?.valueRp ??
    item.values.neon_fly?.valueRp ??
    item.values.neon_ride?.valueRp ??
    item.values.neon?.valueRp ??
    item.values.fly_ride?.valueRp ??
    item.values.fly?.valueRp ??
    item.values.ride?.valueRp ??
    item.values.regular?.valueRp ??
    0
  );
}
