import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PawIcon } from "@/components/icons";

type LayoutProps = {
  children: ReactNode;
};

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-white/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            to="/"
            className="group flex items-center gap-2 text-base font-extrabold tracking-tight text-slate-800"
          >
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-bubble-400 text-white shadow-md ring-1 ring-white/60 transition group-hover:scale-110 group-hover:rotate-3"
            >
              <PawIcon size={18} />
            </span>
            <span className="text-slate-900">
              Adopt Me
              <span className="ml-1 bg-gradient-to-r from-brand-600 to-bubble-500 bg-clip-text text-transparent">
                Values
              </span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm font-semibold text-slate-600">
            <Link
              className="rounded-full px-3 py-1.5 transition hover:bg-brand-100 hover:text-brand-700"
              to="/trade"
            >
              Trade
            </Link>
            <Link
              className="rounded-full px-3 py-1.5 transition hover:bg-brand-100 hover:text-brand-700"
              to="/about"
            >
              About
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-8 border-t border-white/60 bg-white/60 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-6 text-xs leading-relaxed text-slate-600">
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
