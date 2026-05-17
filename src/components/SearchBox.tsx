import { useEffect, useRef } from "react";
import { SearchIcon, XIcon } from "@/components/icons";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

export function SearchBox({
  value,
  onChange,
  placeholder = "Type a pet or item… try \u201CFR Shadow\u201D or \u201CNFR Owl\u201D",
  autoFocus = true,
}: Props) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <label className="block">
      <span className="sr-only">Search pets and items</span>
      <div className="group relative">
        {/* Soft gradient halo that brightens on focus. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-gradient-to-r from-brand-300 via-bubble-300 to-sunny-300 opacity-30 blur-md transition group-focus-within:opacity-70"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 grid w-14 place-items-center text-brand-400 transition group-focus-within:text-brand-600"
        >
          <SearchIcon size={22} />
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
          className="relative w-full rounded-[1.75rem] border-2 border-white bg-white py-4 pl-14 pr-12 text-lg font-semibold text-slate-800 shadow-lg outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-brand-300 focus:shadow-xl"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute inset-y-0 right-3 my-auto grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:scale-110 hover:bg-bubble-100 hover:text-bubble-600 active:scale-95"
          >
            <XIcon size={16} />
          </button>
        )}
      </div>
    </label>
  );
}
