import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

export function SearchBox({
  value,
  onChange,
  placeholder = "Search a pet or item — try 'FR shadow' or 'nfr owl'",
  autoFocus = true,
}: Props) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <label className="block">
      <span className="sr-only">Search pets and items</span>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 grid w-12 place-items-center text-slate-400"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          ref={ref}
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-white/10 bg-slate-900/60 py-4 pl-12 pr-4 text-lg text-white shadow-lg outline-none ring-0 placeholder:text-slate-500 focus:border-brand-500 focus:bg-slate-900"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2 text-sm text-slate-400 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>
    </label>
  );
}
