import { forwardRef } from "react";
import { clsx } from "clsx";

export type StatTone = "bull" | "bear" | "sky" | "accent" | "neutral";
export type DeltaTone = "bull" | "bear" | "neutral";

type StatOwnProps = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Optional delta chip (e.g. "+2.4%"); colored by `deltaTone` or auto from sign. */
  delta?: React.ReactNode;
  /** Force delta color. If omitted and `delta` is a number-like string, sign is inferred. */
  deltaTone?: DeltaTone;
  /** Small caption under the value. */
  sublabel?: React.ReactNode;
  /** Value color tint. */
  tone?: StatTone;
  /** Use the display (Anton) face for the value instead of mono tabular nums. */
  display?: boolean;
  /** Compact padding/sizes. */
  compact?: boolean;
  className?: string;
};

export type StatProps = StatOwnProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof StatOwnProps>;

const VALUE_TONE: Record<StatTone, string> = {
  bull: "text-bull",
  bear: "text-bear",
  sky: "text-sky-300",
  accent: "text-cyan-300",
  neutral: "text-white",
};

const DELTA_TONE: Record<DeltaTone, string> = {
  bull: "border-bull/30 bg-bull/12 text-bull",
  bear: "border-bear/30 bg-bear/12 text-bear",
  neutral: "border-sky-300/20 bg-sky-300/[0.06] text-sky-300",
};

function inferDelta(delta: React.ReactNode): DeltaTone {
  if (typeof delta === "string") {
    const s = delta.trim();
    if (s.startsWith("+") || s.startsWith("▲")) return "bull";
    if (s.startsWith("-") || s.startsWith("−") || s.startsWith("▼")) return "bear";
  }
  return "neutral";
}

/**
 * Metric tile — label + value (+ optional delta chip + sublabel).
 * The value uses mono tabular nums by default (.t-num) or the Anton display face
 * when `display` is set. Delta color is inferred from sign unless `deltaTone` is given.
 */
export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  {
    label,
    value,
    delta,
    deltaTone,
    sublabel,
    tone = "neutral",
    display = false,
    compact = false,
    className,
    ...rest
  },
  ref
) {
  const resolvedDeltaTone = deltaTone ?? inferDelta(delta);

  return (
    <div
      ref={ref}
      className={clsx(
        "flex flex-col rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] backdrop-blur",
        compact ? "gap-1 p-3" : "gap-1.5 p-4",
        className
      )}
      {...rest}
    >
      {/* label: mute (non-grey) at kicker scale */}
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#9fb4d4]">
        {label}
      </span>
      <div className="flex items-end gap-2">
        <span
          className={clsx(
            display
              ? clsx("font-anton leading-none", compact ? "text-2xl" : "text-3xl")
              : clsx("t-num font-bold leading-none", compact ? "text-xl" : "text-2xl"),
            VALUE_TONE[tone]
          )}
        >
          {value}
        </span>
        {delta != null && (
          <span
            className={clsx(
              "mb-0.5 inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
              DELTA_TONE[resolvedDeltaTone]
            )}
          >
            {delta}
          </span>
        )}
      </div>
      {sublabel != null && (
        <span className="text-[11px] leading-snug text-sky-300/70">{sublabel}</span>
      )}
    </div>
  );
});
