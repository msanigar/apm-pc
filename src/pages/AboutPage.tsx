import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ImportRunSummary } from "@shared/types";
import { fetchLatestImportRun } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

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
        className="inline-flex items-center gap-1 text-sm text-brand-300 hover:underline"
      >
        ← Back to search
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-white">About this tool</h1>
      </header>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
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
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Latest import
        </h2>
        {supabaseConfigured === false && (
          <p className="mt-2 text-sm text-slate-400">
            Supabase isn’t configured in this environment, so the UI is reading
            from in-memory mock data.
          </p>
        )}
        {latest && (
          <dl className="mt-3 grid grid-cols-2 gap-3 rounded-2xl border border-white/5 bg-slate-900/40 p-4 text-sm">
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
              <div className="col-span-2 text-xs text-slate-400">
                {latest.notes}
              </div>
            )}
          </dl>
        )}
        {latest === null && supabaseConfigured && (
          <p className="mt-2 text-sm text-slate-400">
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
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-200">{value}</dd>
    </div>
  );
}
