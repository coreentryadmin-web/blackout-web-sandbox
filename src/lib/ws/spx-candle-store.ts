/**
 * In-memory 1-minute OHLC candle aggregator for SPX, fed tick-by-tick from the same
 * Polygon indices "V" channel that already updates `indexStore["I:SPX"].price` in
 * polygon-socket.ts. Powers the Vector live chart's current-bar updates — see
 * src/app/api/market/vector/stream/route.ts.
 *
 * Same shape-of-thinking as indexStore/darkPoolStore: a plain module-level store, no
 * class, no persistence — this is a live view, not a source of truth (the initial
 * historical bars a client seeds from come from Polygon's own REST aggregates, see
 * src/app/(site)/vector/page.tsx).
 */
// Relative import (not the usual @/ alias): its test mocks this module, and
// node:test's mock.module() only reliably matches a specifier that's textually
// identical to the one used here — an aliased specifier resolved to a broken path
// in CI (see spx-candle-store.test.ts).
import { todayEtYmd } from "../providers/spx-session";

export type SpxCandle = {
  /** Bar start, epoch SECONDS (lightweight-charts' UTCTimestamp unit). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const BAR_MS = 60_000;
/** ~a session's worth of 1-minute bars (390 RTH minutes) plus pre/post-market headroom. */
const MAX_BARS = 600;

type CandleStoreState = {
  bars: SpxCandle[];
  current: SpxCandle | null;
  sessionDate: string;
  updatedAt: number;
};

const state: CandleStoreState = { bars: [], current: null, sessionDate: "", updatedAt: 0 };

function resetForNewSession(sessionDate: string): void {
  state.bars = [];
  state.current = null;
  state.sessionDate = sessionDate;
}

/** Feed one live SPX price tick into the aggregator. Called from polygon-socket.ts's "V" handler. */
export function recordSpxTick(price: number, atMs: number = Date.now()): void {
  if (!Number.isFinite(price) || price <= 0) return;

  const sessionDate = todayEtYmd();
  if (sessionDate !== state.sessionDate) resetForNewSession(sessionDate);

  const barTime = Math.floor(atMs / BAR_MS) * (BAR_MS / 1000);

  if (state.current && state.current.time === barTime) {
    state.current.high = Math.max(state.current.high, price);
    state.current.low = Math.min(state.current.low, price);
    state.current.close = price;
  } else {
    if (state.current) {
      state.bars.push(state.current);
      if (state.bars.length > MAX_BARS) state.bars.splice(0, state.bars.length - MAX_BARS);
    }
    state.current = { time: barTime, open: price, high: price, low: price, close: price };
  }
  state.updatedAt = Date.now();
}

/** Read-only snapshot of the currently-forming bar, for the Vector SSE stream. */
export function getCurrentSpxCandle(): { current: SpxCandle | null; updatedAt: number } {
  return { current: state.current, updatedAt: state.updatedAt };
}
