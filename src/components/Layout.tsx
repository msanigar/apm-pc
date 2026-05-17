import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type LayoutProps = {
  children: ReactNode;
};

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white"
          >
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-lg bg-brand-700 text-base"
            >
              {/* Tiny inline glyph keeps us off external icon CDNs. */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m11 17.59-3-3a1 1 0 0 1 1.41-1.42L11 14.76l5.59-5.59a1 1 0 1 1 1.41 1.41L11 17.59Z" />
                <circle cx="12" cy="12" r="10" />
              </svg>
            </span>
            <span>Adopt Me Value Checker</span>
          </Link>
          <nav className="text-sm text-slate-300">
            <Link className="hover:text-white" to="/about">
              About
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 bg-slate-950/60">
      <div className="mx-auto max-w-3xl px-4 py-6 text-xs leading-relaxed text-slate-400">
        <p>
          Fan-made value checker. Not affiliated with Roblox, Uplift Games, or
          Adopt Me. Values are community estimates and may vary by trade.
        </p>
        <p className="mt-2">
          Built with React, Tailwind, Netlify and Supabase. Source data is
          aggregated daily from multiple community sources.
        </p>
      </div>
    </footer>
  );
}
