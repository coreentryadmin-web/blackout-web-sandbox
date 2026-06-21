import { getSpxDeskSummary } from "@/lib/platform/spx-service";
import { runHuntScan } from "../hunt-builder";
import type { HuntPlay } from "../types";
import {
  filterPlaysByMaxDte,
  filterSignalsBySpxAlignment,
  parseDayMaxDte,
} from "./day-trade-filters";
import type { DayTradeAgentConfig, DayTradeAgentRun, DayTradeSignal } from "./day-trade-types";

/**
 * Returns true when the US equity market is closed for the day (>= 16:00 ET).
 * Uses a fixed UTC offset: ET is UTC-4 during EDT (Mar–Nov) and UTC-5 during EST (Nov–Mar).
 */
function isMarketClosed(now: Date = new Date()): boolean {
  // Approximate ET offset: EDT = UTC-4, EST = UTC-5.
  const month = now.getUTCMonth() + 1; // 1-based
  const etOffsetHours = month >= 3 && month <= 11 ? -4 : -5;
  const etHour = now.getUTCHours() + etOffsetHours;
  const etMinute = now.getUTCMinutes();
  return etHour > 16 || (etHour === 16 && etMinute >= 0);
}

/**
 * Expire any CANDIDATE or WATCH signals when the market is at or past 16:00 ET.
 * Stale 0DTE signals must not persist as actionable after the close.
 */
function expireSignalsAtMarketClose(signals: DayTradeSignal[], now: Date = new Date()): DayTradeSignal[] {
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
