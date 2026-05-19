import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSearchIndex } from "@/lib/useSearchIndex";
import {
  addSlot,
  balanceVerdict,
  decodeFromQuery,
  encodeToQuery,
  isStateEmpty,
  loadDraftFromStorage,
  makeEmptyState,
  removeSlotAt,
  saveDraftToStorage,
  sideTotals,
  swapSides,
  type TradeSideName,
  type TradeSlot,
  type TradeState,
} from "@/lib/trade";
import { TradeSide } from "@/components/trade/TradeSide";
import { TradeBalance } from "@/components/trade/TradeBalance";
import { TradeItemPicker } from "@/components/trade/TradeItemPicker";
import { PawIcon } from "@/components/icons";

export function TradePage() {
  const { items, fuse, isLoading, error } = useSearchIndex();
  const [searchParams, setSearchParams] = useSearchParams();

  // Seed state once on mount: prefer the URL query if present (so shareable
  // links work), then fall back to a saved draft, then empty.
  const [state, setState] = useState<TradeState>(() => {
    const hasUrlState = searchParams.get("l") || searchParams.get("r");
    if (hasUrlState) return decodeFromQuery(searchParams);
    return loadDraftFromStorage() ?? makeEmptyState();
  });

  const [pickerSide, setPickerSide] = useState<TradeSideName | null>(null);

  // Keep the URL + localStorage in sync with state, but skip the very first
  // render where state came FROM the URL (otherwise the initial pageload
  // briefly replaces a clean URL with an encoded duplicate).
  const isFirstSync = useRef(true);
  useEffect(() => {
    if (isFirstSync.current) {
      isFirstSync.current = false;
      return;
    }
    const encoded = encodeToQuery(state);
    setSearchParams(new URLSearchParams(encoded), { replace: true });
    saveDraftToStorage(state);
  }, [state, setSearchParams]);

  const bySlug = useMemo(() => {
    const map = new Map(items.map((i) => [i.slug, i] as const));
    return map;
  }, [items]);

  const verdict = useMemo(() => {
    const l = sideTotals(state.left, bySlug);
    const r = sideTotals(state.right, bySlug);
    return balanceVerdict(l, r);
  }, [state, bySlug]);

  const handleAdd = useCallback(
    (sideName: TradeSideName, slot: TradeSlot) => {
      setState((prev) => ({
        ...prev,
        [sideName]: addSlot(prev[sideName], slot),
      }));
    },
    []
  );

  const handleRemove = useCallback((sideName: TradeSideName, idx: number) => {
    setState((prev) => ({
      ...prev,
      [sideName]: removeSlotAt(prev[sideName], idx),
    }));
  }, []);

  const handleClear = useCallback((sideName: TradeSideName) => {
    setState((prev) => ({ ...prev, [sideName]: { slots: [] } }));
  }, []);

  const handleSwap = useCallback(() => setState((prev) => swapSides(prev)), []);

  const handleReset = useCallback(() => {
    setState(makeEmptyState());
  }, []);

  const handleShare = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    const encoded = encodeToQuery(state);
    const longUrl = `${window.location.origin}/trade${encoded ? `?${encoded}` : ""}`;

    // Try to mint a short URL via the API; fall back to the long inline
    // URL on any failure so the share flow never breaks. Race-safe: we
    // copy whatever wins inside this single async pass and ignore stale
    // state changes (the button is disabled while sharing anyway).
    let url = longUrl;
    if (encoded) {
      try {
        const res = await fetch("/api/short", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: encoded }),
        });
        if (res.ok) {
          const data = (await res.json()) as { url?: unknown };
          if (typeof data?.url === "string" && data.url) {
            url = data.url;
          }
        }
      } catch {
        // network error or offline — silently keep the long URL
      }
    }
    await navigator.clipboard.writeText(url);
  }, [state]);

  const empty = isStateEmpty(state);

  return (
    <section className="space-y-6">
      <header className="space-y-2 pt-2">
        <h1 className="text-balance text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
          Trade{" "}
          <span className="bg-gradient-to-r from-brand-500 via-bubble-500 to-sunny-500 bg-clip-text text-transparent">
            balance
          </span>
        </h1>
        <p className="text-sm font-medium text-slate-600 sm:text-base">
          Build both sides of a trade and see if it’s even. 18 items per side,
          same as in-game.
        </p>
      </header>

      {error && (
        <div className="rounded-3xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          Couldn’t load the search index: {error}
        </div>
      )}

      {isLoading && items.length === 0 && !error && (
        <div className="rounded-3xl border border-white/80 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-bubble-400 text-white shadow-md animate-bounce-soft">
            <PawIcon size={26} />
          </div>
          <p className="mt-3 text-sm font-bold text-slate-600">Loading values…</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-start">
          <TradeSide
            side={state.left}
            label="Your offer"
            accentClass="text-brand-700"
            bySlug={bySlug}
            onAddSlot={() => setPickerSide("left")}
            onRemoveAt={(i) => handleRemove("left", i)}
            onClear={() => handleClear("left")}
          />

          <div className="self-stretch md:flex md:min-w-[14rem] md:max-w-[16rem] md:items-center md:px-1">
            <TradeBalance
              verdict={verdict}
              leftLabel="Your offer"
              rightLabel="Their offer"
              onSwap={handleSwap}
              onReset={handleReset}
              onShare={handleShare}
              isEmpty={empty}
            />
          </div>

          <TradeSide
            side={state.right}
            label="Their offer"
            accentClass="text-bubble-600"
            bySlug={bySlug}
            onAddSlot={() => setPickerSide("right")}
            onRemoveAt={(i) => handleRemove("right", i)}
            onClear={() => handleClear("right")}
          />
        </div>
      )}

      <TradeItemPicker
        isOpen={pickerSide !== null}
        fuse={fuse}
        items={items}
        onClose={() => setPickerSide(null)}
        onPick={(slot) => {
          if (pickerSide) handleAdd(pickerSide, slot);
        }}
      />
    </section>
  );
}
