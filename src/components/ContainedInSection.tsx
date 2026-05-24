import { Link } from "react-router-dom";
import type { ContainedIn } from "@shared/types";
import { CategoryGiftIcon } from "@/components/icons";

type Props = {
  containers: ContainedIn[];
};

export function ContainedInSection({ containers }: Props) {
  if (containers.length === 0) return null;
  return (
    <section className="space-y-2 rounded-3xl border border-white/80 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 px-1 text-xs font-extrabold uppercase tracking-widest text-slate-500">
        <span className="grid h-5 w-5 place-items-center rounded-lg bg-rose-100 text-rose-600">
          <CategoryGiftIcon size={11} />
        </span>
        Found in
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {containers.map((c, i) => (
          <li key={`${c.containerSlug}-${i}`}>
            <Link
              to={`/items/${c.containerSlug}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-rose-50 hover:text-rose-700 hover:ring-rose-200 active:scale-95"
            >
              {c.containerImageUrl ? (
                <img
                  src={c.containerImageUrl}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-md border border-white object-cover"
                />
              ) : (
                <CategoryGiftIcon size={12} className="text-rose-500" />
              )}
              <span className="truncate">{c.containerName}</span>
              {c.dropChancePct != null && (
                <span className="-mr-1 ml-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-600">
                  {formatPct(c.dropChancePct)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatPct(pct: number): string {
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(1)}%`;
}
