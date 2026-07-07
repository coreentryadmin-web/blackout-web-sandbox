import { getSpxDeskSummary } from "@/features/spx/lib/spx-service";
import { formatEtDate, isBeforeOrAtMarketCloseEt } from "@/features/nighthawk/lib/session";
import { runHuntScan } from "../hunt-builder";
import type { HuntPlay } from "../types";
import {
  filterPlaysByMaxDte,
  filterSignalsBySpxAlignment,
  parseDayMaxDte,
} from "./day-trade-filters";
import type { DayTradeAgentConfig, DayTradeAgentRun, DayTradeSignal } from "./day-trade-types";

/**
 * Returns true when the US equity market is closed for the day: either it isn't a
 * trading day at all (weekend/holiday), or it's a trading day at/past 16:00 ET.
 *
 * Previously hand-rolled a fixed UTC offset ("EDT Mar-Nov, EST otherwise") and had no
 * weekday/holiday check at all. Both were bugs: the real US DST boundary is the 2nd
 * Sunday of March -> 1st Sunday of November, not calendar-month edges, so the offset
 * was wrong for ~5 weeks a year (all of November after DST truly ends, and early March
 * before it truly starts) — a full 1-hour skew that made this function think the market
 * had closed while it was still open. Confirmed live: at Mar 5 2026 20:45 UTC (real ET
 * 15:45, market open) the old month-based math used the EDT offset (-4) instead of the
 * correct EST offset (-5) for that date, computing 16:45 ET and returning `true` a full
 * hour early. Fixed by delegating to the canonical ET-aware helpers in
 * `@/features/nighthawk/lib/session` (`isBeforeOrAtMarketCloseEt`, backed by `Intl.DateTimeFormat`
 * with the real `America/New_York` timezone database, so it tracks the actual DST
 * transition dates) instead of re-deriving the ET offset by hand — the same helper
 * `nighthawk/edition/route.ts` already uses, and the same `Intl`-based approach
 * `zerodte/scan.ts`'s `etNowParts()` calls use. `isBeforeOrAtMarketCloseEt` also folds
 * in `isTradingDayEt`, which adds the weekday/holiday gate every other EOD-discipline
 * gate in the codebase already has (`isSpxEngineCronWindow`, `isPastForceExitCutoff`'s
 * early-close table, etc.) but this function was missing — a weekend/holiday day now
 * correctly reads as "closed" instead of silently gliding through the hour math as if
 * it were a live trading session.
 */
export function isMarketClosed(now: Date = new Date()): boolean {
  return !isBeforeOrAtMarketCloseEt(formatEtDate(now), now);
}

/**
 * Expire any CANDIDATE or WATCH signals when the market is at or past 16:00 ET.
 * Stale 0DTE signals must not persist as actionable after the close.
 */
export function expireSignalsAtMarketClose(signals: DayTradeSignal[], now: Date = new Date()): DayTradeSignal[] {
  if (!isMarketClosed(now)) return signals;
  return signals.map((s) =>
    s.phase === "CANDIDATE" || s.phase === "WATCH"
      ? { ...s, phase: "EXPIRED" as const }
      : s
  );
}

function toDayTradeSignal(play: HuntPlay, spxAligned?: boolean): DayTradeSignal {
  return {
    ...play,
    phase: "CANDIDATE",
    spx_aligned: spxAligned,
  };
}

/**
 * Day Trade Agent — user-triggered intraday hunt with wired day filters
 * (max DTE, SPX alignment) on top of the shared hunt pipeline.
 */
export async function runDayTradeAgent(config: DayTradeAgentConfig): Promise<DayTradeAgentRun> {
  const started = Date.now();
  const runId = `day-${started}`;
  const requireSpx = config.filters.spx_context !== false;
  const maxDte = parseDayMaxDte(config.filters);

  const [scan, spx] = await Promise.all([
    runHuntScan({ mode: "day", filters: config.filters }),
    requireSpx ? getSpxDeskSummary().catch(() => null) : Promise.resolve(null),
  ]);

  let playbookPlays = scan.playbookPlays;
  playbookPlays = filterPlaysByMaxDte(playbookPlays, maxDte);

  const huntByTicker = new Map(scan.plays.map((p) => [p.ticker, p]));
  let signals: DayTradeSignal[] = playbookPlays.map((p) => {
    const hunt = huntByTicker.get(p.ticker);
    return toDayTradeSignal(
      hunt ?? {
        ticker: p.ticker,
        direction: p.direction,
        thesis: p.thesis || p.key_signal,
        contract: p.options_play,
        entry: p.entry_range,
        target: p.target,
        stop: p.stop,
        score: p.score,
      }
    );
  });

  const { signals: aligned, bias, dropped } = filterSignalsBySpxAlignment(signals, spx, requireSpx);
  signals = aligned;

  // Expire CANDIDATE/WATCH plays at or after 16:00 ET so stale 0DTE signals
  // do not show as CANDIDATE after market close.
  const now = new Date();
  signals = expireSignalsAtMarketClose(signals, now);

  const ok = signals.length > 0;
  let message = scan.message;
  if (scan.ok && dropped > 0) {
    message = `${message} ${dropped} play(s) dropped for SPX misalignment.`;
  }
  if (scan.ok && playbookPlays.length < scan.playbookPlays.length) {
    message = `${message} ${scan.playbookPlays.length - playbookPlays.length} play(s) dropped for 0DTE filter.`;
  }
  if (scan.ok && !ok) {
    message = "Scan complete but no plays passed day-trade filters (DTE / SPX alignment).";
  }

  return {
    id: runId,
    started_at: new Date(started).toISOString(),
    completed_at: new Date().toISOString(),
    ok,
    message,
    signals,
    candidates: scan.candidates,
    duration_ms: Date.now() - started,
    error: ok ? undefined : scan.error ?? "no_day_signals",
    spx_bias: bias,
  };
}
