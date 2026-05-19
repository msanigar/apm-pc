import { useState } from "react";
import { formatRp } from "@/lib/format";
import { type TradeVerdict } from "@/lib/trade";

type Props = {
  verdict: TradeVerdict;
  leftLabel: string;
  rightLabel: string;
  onSwap: () => void;
  onReset: () => void;
  /**
   * Minting a short URL hits the API, so `onShare` returns a Promise.
   * We await it before flipping the button label so "Link copied!" only
   * appears once the clipboard actually has something.
   */
  onShare: () => Promise<void> | void;
  isEmpty: boolean;
};

export function TradeBalance({
  verdict,
  leftLabel,
  rightLabel,
  onSwap,
  onReset,
  onShare,
  isEmpty,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    try {
      await onShare();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="flex w-full flex-col items-center gap-3 rounded-3xl border border-white/80 bg-gradient-to-br from-brand-50 via-white to-bubble-50 p-4 text-center shadow-sm">
      <VerdictDisplay verdict={verdict} leftLabel={leftLabel} rightLabel={rightLabel} />

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <ActionButton onClick={onSwap} disabled={isEmpty}>
          ⇄ Swap sides
        </ActionButton>
        <ActionButton onClick={handleShare} disabled={isEmpty || sharing}>
          {copied ? "Link copied!" : sharing ? "Generating…" : "Copy link"}
        </ActionButton>
        <ActionButton onClick={onReset} disabled={isEmpty} variant="danger">
          Reset
        </ActionButton>
      </div>
    </section>
  );
}

function VerdictDisplay({
  verdict,
  leftLabel,
  rightLabel,
}: {
  verdict: TradeVerdict;
  leftLabel: string;
  rightLabel: string;
}) {
  if (verdict.kind === "empty") {
    return (
      <div className="space-y-1 py-2">
        <p className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
          Balance
        </p>
        <p className="text-2xl font-black text-slate-300">— RP</p>
        <p className="text-xs font-semibold text-slate-500">
          Add items to both sides to see how the trade balances.
        </p>
      </div>
    );
  }

  if (verdict.kind === "even") {
    return (
      <div className="space-y-1 py-1">
        <p className="text-xs font-extrabold uppercase tracking-widest text-emerald-600">
          Balance
        </p>
        <p className="animate-pop-in text-2xl font-black text-emerald-600">
          Even trade
        </p>
        <p className="text-xs font-semibold text-slate-500">
          Within 5% — {verdict.deltaRp > 0 ? `${formatRp(verdict.deltaRp)} apart` : "perfectly matched"}.
        </p>
      </div>
    );
  }

  const favored = verdict.favors === "left" ? leftLabel : rightLabel;
  const isHeavy = verdict.kind === "heavy";

  return (
    <div className="space-y-1 py-1">
      <p
        className={`text-xs font-extrabold uppercase tracking-widest ${
          isHeavy ? "text-rose-600" : "text-amber-600"
        }`}
      >
        Balance · {Math.round(verdict.deltaPct * 100)}% diff
      </p>
      <p
        className={`text-2xl font-black tabular-nums ${
          isHeavy ? "text-rose-600 animate-pop-in" : "text-amber-600 animate-pop-in"
        }`}
      >
        +{formatRp(verdict.deltaRp)}
      </p>
      <p className="text-xs font-semibold text-slate-600">
        {isHeavy ? "Heavily favors" : "Slightly favors"}{" "}
        <span className="font-extrabold text-slate-900">{favored}</span>
      </p>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  variant = "default",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  children: React.ReactNode;
}) {
  const base =
    "rounded-full px-3 py-1.5 text-xs font-extrabold ring-1 ring-inset transition active:scale-95 disabled:opacity-40 disabled:hover:translate-y-0";
  const colors =
    variant === "danger"
      ? "bg-white text-rose-600 ring-rose-200 hover:-translate-y-0.5 hover:bg-rose-50"
      : "bg-white text-slate-700 ring-slate-200 hover:-translate-y-0.5 hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${colors}`}>
      {children}
    </button>
  );
}
