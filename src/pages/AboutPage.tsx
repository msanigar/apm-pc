import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ImportRunSummary } from "@shared/types";
import { fetchLatestImportRun } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { ArrowLeftIcon } from "@/components/icons";

export function AboutPage() {
  const [latest, setLatest] = useState<ImportRunSummary | null>(null);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    fetchLatestImportRun()
      .then((res) => {
        setLatest(res.run);
        setSupabaseConfigured(res.supabaseConfigured);
      })
      .catch(() => {
        /* swallow — about page is best-effort */
      });
  }, []);

  return (
    <article className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 text-sm font-bold text-brand-700 shadow-sm ring-1 ring-white/80 transition hover:-translate-x-0.5 hover:bg-white"
      >
        <ArrowLeftIcon size={14} />
        Back to search
      </Link>

      <header>
        <h1 className="text-3xl font-black text-slate-900">
          About this{" "}
          <span className="bg-gradient-to-r from-brand-500 to-bubble-500 bg-clip-text text-transparent">
            tool
          </span>
        </h1>
      </header>

      <section className="space-y-3 rounded-3xl border border-white/80 bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm">
        <p>
          This is a lightweight, ad-free Adopt Me value checker. It aggregates
          RP values from a handful of community sources once per day, applies a
          median across the sources, and shows the result alongside how many
          sources agreed and how confident we are.
        </p>
        <p>
          We never overwrite the live dataset with an import that looks wrong.
          If a value swings unusually hard, or if too many items go missing or
          a source goes down, we hold back the suspicious rows (or the whole
          import) and keep the previous values instead.
        </p>
        <p>
          This site is a fan-made project. It is not affiliated with Roblox,
          Uplift Games, or Adopt Me. Values are community estimates and may
          vary by trade.
        </p>
      </section>

      <section>
        <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
          Latest import
        </h2>
        {supabaseConfigured === false && (
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Supabase isn’t configured in this environment, so the UI is reading
            from in-memory mock data.
          </p>
        )}
        {latest && (
          <dl className="mt-3 grid grid-cols-2 gap-3 rounded-3xl border border-white/80 bg-white p-5 text-sm shadow-sm sm:grid-cols-3">
            <ImportField label="Status" value={latest.status} />
            <ImportField
              label="Started"
              value={formatRelativeTime(latest.startedAt)}
            />
            <ImportField label="Items" value={String(latest.itemCount ?? 0)} />
            <ImportField
              label="Promoted"
              value={String(latest.promotedCount)}
            />
            <ImportField label="Held back" value={String(latest.heldBackCount)} />
            <ImportField label="Missing" value={String(latest.missingCount)} />
            {latest.notes && (
              <div className="col-span-2 text-xs text-slate-500 sm:col-span-3">
                {latest.notes}
              </div>
            )}
          </dl>
        )}
        {latest === null && supabaseConfigured && (
          <p className="mt-2 text-sm font-semibold text-slate-600">
            No import runs yet. The scheduled function will fire on its next
            cron tick.
          </p>
        )}
      </section>
    </article>
  );
}

function ImportField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2">
      <dt className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-bold text-slate-800">{value}</dd>
    </div>
  );
}
