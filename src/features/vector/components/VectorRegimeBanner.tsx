"use client";

import clsx from "clsx";
import type { VectorRegime } from "@/features/vector/lib/vector-regime";

type Props = {
  regime: VectorRegime;
};

/**
 * Gamma regime banner — the plain-English "what does this positioning mean"
 * strip above the chart. Long gamma reads calm (cyan), short gamma reads
 * volatile (amber), at-flip reads undecided. Hidden when the regime is unknown
 * (no positioning data) rather than showing a hollow chip.
 */
export function VectorRegimeBanner({ regime }: Props) {
  if (regime.posture === "unknown") return null;
  return (
    <div
      className={clsx("vector-regime-banner", `vector-regime-${regime.tone}`)}
      role="status"
      aria-live="polite"
      data-testid="vector-regime-banner"
    >
      <span className="vector-regime-chip">
        <span className="vector-regime-dot" aria-hidden="true" />
        {regime.headline}
      </span>
      <span className="vector-regime-read">{regime.read}</span>
    </div>
  );
}
