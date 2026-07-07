"use client";

import { useEffect } from "react";
import { marketStatusLabel, type MarketStatusLabel } from "@/features/spx/lib/spx-market-session";

/**
 * VITALS Phase 1 — the single cadence source ("one heartbeat").
 *
 * Computes the SPX session client-side and publishes the market-pulse cadence
 * vars onto <html> so every ambient element (pulse wash, EKG hairline, aurora
 * mesh, circuit drift) breathes at the market's pace instead of inventing its
 * own timing:
 *   RTH OPEN          → 6s  / peak 1.0  / dim 0.7   (calm, alive)
 *   PRE-MARKET / EXT  → 11s / peak 0.7  / dim 0.5   (slower, dimmer)
 *   CLOSED / weekend  → 16s / peak 0.45 / dim 0.4   (near-flatline)
 *
 * The session is computed ONLY inside useEffect (never during render) so the
 * Date-derived value can never cause a hydration mismatch (React #418). No
 * Math.random, no Date read in the render path.
 *
 * Renders nothing — it is a pure side-effect provider mounted once in the
 * platform shell.
 */

type Cadence = { period: string; peak: string; dim: string };

const CADENCE: Record<MarketStatusLabel, Cadence> = {
  "RTH OPEN": { period: "6s", peak: "1", dim: "0.7" },
  "PRE-MARKET": { period: "11s", peak: "0.7", dim: "0.5" },
  EXTENDED: { period: "11s", peak: "0.7", dim: "0.5" },
  CLOSED: { period: "16s", peak: "0.45", dim: "0.4" },
};

function applyCadence() {
  if (typeof document === "undefined") return;
  const label = marketStatusLabel();
  const cadence = CADENCE[label] ?? CADENCE.CLOSED;
  const root = document.documentElement.style;
  root.setProperty("--pulse-period", cadence.period);
  root.setProperty("--pulse-peak", cadence.peak);
  root.setProperty("--pulse-dim", cadence.dim);
  // Expose the session label so any consumer can read the live session.
  document.documentElement.setAttribute("data-market-session", label);
}

export function MarketSessionProvider() {
  useEffect(() => {
    // Initial evaluation after mount (post-hydration — safe from #418).
    applyCadence();

    // Re-evaluate every 60s to roll the cadence across session boundaries.
    const interval = window.setInterval(applyCadence, 60_000);

    // Re-evaluate the moment the tab becomes visible again, so a desk left
    // open overnight snaps to the correct session immediately on return.
    const onVisibility = () => {
      if (!document.hidden) applyCadence();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}

export default MarketSessionProvider;
