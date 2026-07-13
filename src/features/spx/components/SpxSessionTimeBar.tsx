"use client";

// SESSION TIME BAR (SPX desk, 2026-07-13, upgrade #2): a thin full-width RTH timeline under
// the desk header — playbook execution windows (REAL registry sessionWindow definitions) and
// today's macro block windows as labeled bands, Largo voice-event dots at the times they
// fired this session (same sessionStorage feed the commentary rail persists), and a
// now-cursor that ticks each minute. Pre-open/post-close the cursor hides and a session
// label shows instead. Hover any band/dot for details (native title tooltips).
//
// The right edge hosts the FOCUS toggle button (upgrade #3) — the desk's one toolbar spot.

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { MacroEvent } from "@/lib/providers/macro-events";
import {
  assignTimebarLanes,
  bandGeometry,
  hourTickPcts,
  macroWindowBands,
  nowCursorPct,
  playbookWindowBands,
  sessionPhase,
  sessionPhaseLabel,
} from "@/features/spx/lib/spx-session-timebar";
import {
  LARGO_FEED_UPDATED_EVENT,
  readLargoFeed,
  type LargoFeedItem,
} from "@/features/spx/lib/spx-largo-feed-cache";
import { etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { todayEt } from "@/lib/et-date";
import { todayEtYmd } from "@/lib/providers/spx-session";

const CLOCK_TICK_MS = 30_000; // minute-resolution cursor; 30s keeps it never >30s stale
const FEED_POLL_MS = 60_000; // fallback poll; the rail's CustomEvent updates us instantly

function fmtDotTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

type Props = {
  /** Today's macro calendar rows from the desk payload (macro block bands). */
  macroEvents?: MacroEvent[];
  live?: boolean;
  focus: boolean;
  onToggleFocus: () => void;
  /** Hidden on compact/iOS shells — no keyboard, no grid to collapse. */
  showFocusToggle?: boolean;
};

export function SpxSessionTimeBar({
  macroEvents,
  live,
  focus,
  onToggleFocus,
  showFocusToggle = true,
}: Props) {
  // Clock + feed state are client-only (Intl tz math / sessionStorage) — start null/empty so
  // SSR markup is stable and the first client tick fills them in.
  const [etMin, setEtMin] = useState<number | null>(null);
  const [tradingDay, setTradingDay] = useState(true);
  const [feed, setFeed] = useState<LargoFeedItem[]>([]);

  useEffect(() => {
    const tick = () => {
      setEtMin(etMinutes());
      setTradingDay(isTradingDayEt(todayEt()));
    };
    tick();
    const id = setInterval(tick, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const refresh = () => setFeed(readLargoFeed());
    refresh();
    window.addEventListener(LARGO_FEED_UPDATED_EVENT, refresh);
    const id = setInterval(refresh, FEED_POLL_MS);
    return () => {
      window.removeEventListener(LARGO_FEED_UPDATED_EVENT, refresh);
      clearInterval(id);
    };
  }, []);

  const bands = useMemo(
    () =>
      assignTimebarLanes([
        ...playbookWindowBands(),
        ...macroWindowBands(macroEvents ?? [], todayEtYmd()),
      ]),
    [macroEvents]
  );

  // Event dots: ET minute-of-day of each feed line → bar position. The feed only ever holds
  // today's session (session-cache is keyed by ET date), so no cross-day filtering needed.
  const dots = useMemo(() => {
    return feed
      .map((item) => {
        const min = etMinutes(new Date(item.at));
        const pct = nowCursorPct(min);
        return pct == null ? null : { ...item, pct };
      })
      .filter((d): d is LargoFeedItem & { pct: number } => d != null);
  }, [feed]);

  const nowPct = etMin != null ? nowCursorPct(etMin) : null;
  const phase = etMin != null ? sessionPhase(etMin, tradingDay) : "rth";
  const ticks = useMemo(hourTickPcts, []);

  return (
    <div className="spx-desk-timebar-row" data-live={live ? "1" : undefined}>
      <span className="spx-desk-timebar-edge" aria-hidden>
        9:30
      </span>
      <div
        className="spx-desk-timebar"
        role="img"
        aria-label="RTH session timeline: playbook windows, macro blocks, Largo events, current time"
      >
        {ticks.map((pct) => (
          <span
            key={pct}
            className="spx-desk-timebar-tick"
            style={{ left: `${pct}%` }}
            aria-hidden
          />
        ))}
        {bands.map((band) => {
          const geo = bandGeometry(band);
          if (!geo) return null;
          return (
            <div
              key={band.id}
              className={clsx("spx-desk-timebar-band", `spx-desk-timebar-band--${band.tone}`)}
              data-lane={band.lane}
              style={{ left: `${geo.leftPct}%`, width: `${geo.widthPct}%` }}
              title={band.detail}
            >
              <span>{band.label}</span>
            </div>
          );
        })}
        {dots.map((dot) => (
          <span
            key={dot.id}
            className={clsx("spx-desk-timebar-dot", `spx-desk-timebar-dot--${dot.tone}`)}
            style={{ left: `${dot.pct}%` }}
            title={`${fmtDotTime(dot.at)} ET — ${dot.line}`}
          />
        ))}
        {nowPct != null ? (
          <span
            className="spx-desk-timebar-now"
            style={{ left: `${nowPct}%` }}
            aria-hidden
            title="Now"
          />
        ) : (
          etMin != null && (
            <span className="spx-desk-timebar-phase">{sessionPhaseLabel(phase)}</span>
          )
        )}
      </div>
      <span className="spx-desk-timebar-edge" aria-hidden>
        4:00
      </span>
      {showFocusToggle && (
        <button
          type="button"
          id="spx-desk-focus-toggle"
          className={clsx("spx-desk-focus-btn", focus && "spx-desk-focus-btn--active")}
          onClick={onToggleFocus}
          aria-pressed={focus}
          title={focus ? "Exit focus mode (F or Esc)" : "Focus mode — chart fills the desk (F)"}
        >
          ⛶ Focus
        </button>
      )}
    </div>
  );
}
