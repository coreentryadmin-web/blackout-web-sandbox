import { dbConfigured, ensureSchema, getMeta, insertSpxSignalLog, setMeta } from "@/lib/db";
import type { SpxSignalFactor } from "@/lib/spx-signals";

const CURSOR_KEY = "spx_signal_log_cursor";

export type SpxSignalLogRow = {
  id: number;
  signal_key: string;
  action: string;
  bias: string;
  score: number;
  confidence: number;
  price: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  headline: string;
  factors: unknown;
  created_at: string;
};

function signalKey(parts: {
  action: string;
  direction?: string | null;
  confidence: number;
  score: number;
  headline: string;
}): string {
  return `${parts.action}|${parts.direction ?? ""}|${parts.confidence}|${Math.round(parts.score)}|${parts.headline}`;
}

export async function maybeLogSpxPlay(
  desk: { price: number; market_open?: boolean },
  play: {
    action: string;
    direction: string | null;
    grade: string;
    score: number;
    confidence: number;
    headline: string;
    thesis: string;
    factors: SpxSignalFactor[];
    levels: {
      entry: number | null;
      stop: number | null;
      target: number | null;
      invalidation: string;
    };
  }
): Promise<void> {
  if (!dbConfigured() || !desk.market_open) return;
  if (!["BUY", "SELL", "TRIM"].includes(play.action)) return;

  const key = signalKey({
    action: play.action,
    direction: play.direction,
    confidence: play.confidence,
    score: play.score,
    headline: play.headline,
  });
  const prev = await getMeta(CURSOR_KEY);
  if (prev === key) return;

  await ensureSchema();
  await insertSpxSignalLog({
    signal_key: key,
    action: play.action,
    bias: play.direction === "long" ? "bullish" : play.direction === "short" ? "bearish" : "neutral",
    score: play.score,
    confidence: play.confidence,
    price: desk.price,
    entry: play.levels.entry,
    stop: play.levels.stop,
    target: play.levels.target,
    headline: play.headline,
    factors: play.factors,
  });
  await setMeta(CURSOR_KEY, key);
}

/** @deprecated Use maybeLogSpxPlay from play engine */
export async function maybeLogSpxSignal(
  desk: import("./spx-desk").SpxDeskPayload
): Promise<void> {
  const { computeSpxTradeSignal } = await import("@/lib/spx-signals");
  const signal = computeSpxTradeSignal(desk);
  if (!signal) return;
  await maybeLogSpxPlay(desk, {
    action: signal.action === "BUY_CALL" || signal.action === "BUY_PUT" ? "BUY" : signal.action,
    direction:
      signal.action === "BUY_CALL" ? "long" : signal.action === "BUY_PUT" ? "short" : null,
    grade: "C",
    score: signal.score,
    confidence: signal.confidence,
    headline: signal.headline,
    thesis: signal.thesis,
    factors: signal.factors,
    levels: signal.levels,
  });
}

export async function fetchRecentSpxSignals(limit = 50): Promise<SpxSignalLogRow[]> {
  if (!dbConfigured()) return [];
  const { fetchRecentSpxSignalLogs } = await import("@/lib/db");
  return fetchRecentSpxSignalLogs(limit);
}
