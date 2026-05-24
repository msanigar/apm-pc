import type { PetAcquisition } from "@shared/types";
import { SparkleIcon } from "@/components/icons";

type Props = {
  acquisitions: PetAcquisition[];
};

const CURRENCY_LABEL: Record<string, string> = {
  robux: "Robux",
  candy: "Candy",
  gingerbread: "Gingerbread",
  bucks: "Bucks",
  tickets: "Tickets",
  stars: "Stars",
  starlight: "Starlight",
};

const KIND_BADGE_CLASS: Record<PetAcquisition["kind"], string> = {
  event: "bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-200",
  robux: "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  paid: "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200",
  task: "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200",
  gift: "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200",
  other: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
};

const KIND_LABEL: Record<PetAcquisition["kind"], string> = {
  event: "Limited event",
  robux: "Robux purchase",
  paid: "In-game purchase",
  task: "Task reward",
  gift: "Gift",
  other: "Other",
};

export function EventAcquisitionSection({ acquisitions }: Props) {
  if (acquisitions.length === 0) return null;

  // Stable sort: events first, then robux, paid, task, gift, other.
  const KIND_ORDER: Record<PetAcquisition["kind"], number> = {
    event: 0,
    robux: 1,
    paid: 2,
    task: 3,
    gift: 4,
    other: 5,
  };
  const sorted = [...acquisitions].sort((a, b) => {
    const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (ko !== 0) return ko;
    return (b.eventYear ?? 0) - (a.eventYear ?? 0);
  });

  return (
    <section className="space-y-3 rounded-3xl border border-white/80 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 px-1 text-xs font-extrabold uppercase tracking-widest text-slate-500">
        <span className="grid h-5 w-5 place-items-center rounded-lg bg-purple-100 text-purple-600">
          <SparkleIcon size={11} />
        </span>
        Limited / event
      </h2>
      <ul className="space-y-2">
        {sorted.map((a, i) => (
          <li
            key={`${a.kind}-${a.eventName ?? "none"}-${i}`}
            className="flex items-start gap-3 rounded-2xl bg-slate-50/60 p-3 ring-1 ring-inset ring-slate-100"
          >
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${KIND_BADGE_CLASS[a.kind]}`}
            >
              {KIND_LABEL[a.kind]}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-bold text-slate-800">
                {acquisitionTitle(a)}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-slate-500">
                {a.cost != null && a.currency && (
                  <span className="font-bold tabular-nums text-slate-700">
                    {formatCost(a.cost)} {currencyLabel(a.currency)}
                  </span>
                )}
                {a.releasedAt && (
                  <span>Released {formatReleaseDate(a.releasedAt)}</span>
                )}
                {a.retired && (
                  <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-rose-600">
                    Retired
                  </span>
                )}
              </p>
              {a.notes && (
                <p className="text-xs italic text-slate-500">{a.notes}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function acquisitionTitle(a: PetAcquisition): string {
  if (a.eventName) {
    return a.eventYear ? `${a.eventName} (${a.eventYear})` : a.eventName;
  }
  if (a.kind === "robux") return "Direct Robux purchase";
  if (a.kind === "paid") return "Currency purchase";
  if (a.kind === "task") return "Task / quest reward";
  if (a.kind === "gift") return "Gift / login reward";
  return "Limited release";
}

function currencyLabel(c: string): string {
  return CURRENCY_LABEL[c.toLowerCase()] ?? c;
}

function formatCost(n: number): string {
  return n.toLocaleString();
}

function formatReleaseDate(iso: string): string {
  // iso = YYYY-MM-DD
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
