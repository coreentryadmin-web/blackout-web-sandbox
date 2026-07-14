/**
 * 0DTE Command — single source of truth for the live board payload.
 * Member route (/api/market/zerodte/board), Largo (get_zerodte_plays), and BIE
 * composers (composeZeroDtePlays / composeTickerPlayState) all read through here
 * so ledger PnL, intel lines, and Night Hawk dedupe never drift.
 */
import type { ZeroDteSetupLogRow } from "@/lib/db";
import { fetchNighthawkEchoForTickers, type EcosystemNightHawkTake } from "@/lib/bie/ecosystem-context";
import { etNowParts, isTradingDayEt, nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { readGridEarnings } from "@/lib/zerodte/earnings";
import { withServerCache, serverCache, TTL } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import {
  matchEarnings,
  matchHotNews,
  resolveFreshFindStatus,
  sessionHeat,
  type EnrichedZeroDteSetup,
} from "@/lib/zerodte/board";
import { buildIntelNote } from "@/lib/zerodte/intel";
import {
  closedStopReason,
  isZeroDteMarkStale,
  pinnedLivePnlPct,
  ZERODTE_MARK_STALE_MS,
  type ZeroDteMarkSource,
} from "@/lib/zerodte/marks-math";
import { PLAN_RULES } from "@/lib/zerodte/plan";
import { gradeZeroDteLedger, readZeroDteLedger, scanZeroDteBoard, syncLedgerLiveState } from "@/lib/zerodte/scan";

export type ZeroDteBoardLedgerRow = {
  ticker: string;
  direction: "long" | "short";
  score_max: number;
  spike: boolean;
  first_flagged_at: string;
  underlying_at_flag: number | null;
  top_strike: number | null;
  conviction: string | null;
  entry_premium: number | null;
  flow_avg_fill: number | null;
  status: string | null;
  last_mark: number | null;
  live_pnl_pct: number | null;
  /** Why a CLOSED play closed, when derivable from the latched extremes:
   *  "stopped" pins live_pnl_pct to the −50% stop (B-9 D-1 fix — the number the
   *  post-session grader will stamp), null = live row or a time-stop close. */
  closed_reason: "stopped" | null;
  /** ISO instant of the quote behind last_mark, when the live-marks lane served
   *  it (B-9). Null = legacy sync lane (no per-quote timestamp available). */
  mark_as_of: string | null;
  /** Mark provenance from the live lane: "mid" = two-sided quote, "last" =
   *  last-trade fallback (flagged), null = legacy sync lane. */
  mark_source: ZeroDteMarkSource | null;
  move_pct: number | null;
  direction_hit: boolean | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  graded: boolean;
  nighthawk_echo: EcosystemNightHawkTake | null;
};

export type ZeroDteBoardPayload = {
  available: true;
  as_of: string;
  upstream_ok: boolean;
  session: {
    date: string;
    trading_day: boolean;
    heat: ReturnType<typeof sessionHeat>;
  };
  setups: EnrichedZeroDteSetup[];
  ledger: ZeroDteBoardLedgerRow[];
  covered_elsewhere: string[];
};

const BOARD_TTL_MS = 5_000;

/** A live-lane mark overlay for one ledger row (see attachLiveMarkMeta below). */
type LiveMarkMeta = { mark: number; mark_as_of: string; mark_source: ZeroDteMarkSource };

function mapLedgerRow(
  r: ZeroDteSetupLogRow,
  nighthawkEcho: Awaited<ReturnType<typeof fetchNighthawkEchoForTickers>>,
  liveMark: LiveMarkMeta | null
): ZeroDteBoardLedgerRow {
  // B-9: the board's mark prefers the 1s live-marks lane when it has a FRESH quote
  // for this contract — the same store the SSE push and the poller's ledger sync
  // read — so every consumer of this payload shows the same number. The legacy
  // sync value (r.last_mark) remains the fallback and carries no per-quote
  // timestamp, which is surfaced honestly as mark_as_of: null.
  const lastMark = liveMark?.mark ?? r.last_mark;
  // D-1 fix: a stopped play's displayed P&L is the stop P&L (what the grader will
  // stamp), never the frozen last_mark of whichever tick happened to cross it.
  const closedReason = closedStopReason({
    status: r.status,
    entry_premium: r.entry_premium,
    peak_premium: r.peak_premium,
    trough_premium: r.trough_premium,
  });
  return {
    ticker: r.ticker,
    direction: r.direction,
    score_max: r.score_max,
    spike: r.spike,
    first_flagged_at: r.first_flagged_at,
    underlying_at_flag: r.underlying_at_flag,
    top_strike: r.top_strike,
    conviction: r.conviction,
    entry_premium: r.entry_premium,
    flow_avg_fill: r.flow_avg_fill,
    status: r.status,
    last_mark: lastMark,
    live_pnl_pct:
      closedReason === "stopped" ? PLAN_RULES.stop_pct : pinnedLivePnlPct(r.entry_premium, lastMark),
    closed_reason: closedReason,
    mark_as_of: liveMark?.mark_as_of ?? null,
    mark_source: liveMark?.mark_source ?? null,
    move_pct: r.move_pct,
    direction_hit: r.direction_hit,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct,
    graded: r.graded_at != null,
    nighthawk_echo: nighthawkEcho.get(r.ticker.toUpperCase()) ?? null,
  };
}

/**
 * Read the live-marks store (B-9 lane) for each non-CLOSED ledger row's contract.
 * Lazy-imported so this module's import graph (and its tests) stay free of the
 * lane's db/providers/ws dependencies; any failure degrades to the legacy sync
 * marks (empty map). Only FRESH quotes (≤ZERODTE_MARK_STALE_MS) overlay — a stale
 * store must never beat the sync's just-fetched snapshot.
 */
async function attachLiveMarkMeta(rows: ZeroDteSetupLogRow[]): Promise<Map<string, LiveMarkMeta>> {
  const out = new Map<string, LiveMarkMeta>();
  try {
    // RELATIVE specifier, not the "@/" alias: the tsx ESM loader (CI test runs) cannot
    // resolve tsconfig path aliases in dynamic import() — the alias form threw
    // ERR_MODULE_NOT_FOUND into this function's fail-soft catch, silently serving NO
    // live marks in tests while Next's bundler (prod) resolved it fine. Relative works
    // under both, and keeps the test's seeded store the SAME module instance.
    const { getZeroDteLiveMark, ensureZeroDteMarkPoller } = await import("../zerodte/live-marks");
    // Any board consumer keeps the 1s lane alive (idempotent; self-idles off-RTH),
    // so Largo/BIE reads through this payload stay fresh even with no SSE viewer.
    ensureZeroDteMarkPoller();
    const now = Date.now();
    for (const r of rows) {
      if (r.status === "CLOSED") continue;
      const occ = typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null;
      if (!occ) continue;
      const m = getZeroDteLiveMark(occ);
      if (!m || m.mark == null || isZeroDteMarkStale(m.asOf, now, ZERODTE_MARK_STALE_MS)) continue;
      out.set(r.ticker.toUpperCase(), {
        mark: m.mark,
        mark_as_of: new Date(m.asOf).toISOString(),
        mark_source: m.source,
      });
    }
  } catch {
    // Live lane unavailable (e.g. edge/test env) — legacy sync marks stand.
  }
  return out;
}

/** Uncached board assembly — the exact pipeline the member route used before extraction. */
export async function buildZeroDteBoardPayload(): Promise<ZeroDteBoardPayload> {
  const today = todayEt();
  const tradingDay = isTradingDayEt(today);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);

  const [news, earningsSnap, rawLedger] = await Promise.all([
    serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15)).catch(() => []),
    readGridEarnings().catch(() => null),
    readZeroDteLedger(),
  ]);

  const ledgerRows = await syncLedgerLiveState(rawLedger).catch(() => rawLedger);
  const [nighthawkEcho, liveMarks] = await Promise.all([
    fetchNighthawkEchoForTickers(ledgerRows.map((r) => r.ticker)),
    attachLiveMarkMeta(ledgerRows),
  ]);

  const nextDay = nextTradingDayEt(today);
  const earningsFlags = matchEarnings(earningsSnap?.items ?? [], { today, nextDay });
  const newsFlags = matchHotNews(news, Date.now());

  const { setups, nighthawk_covered, upstream_ok } = await scanZeroDteBoard({
    earnings: earningsFlags,
    news: newsFlags,
  });

  void gradeZeroDteLedger().catch(() => {});

  const payload = roundFloats({
    available: true,
    as_of: new Date().toISOString(),
    upstream_ok,
    session: { date: today, trading_day: tradingDay, heat },
    setups,
    ledger: ledgerRows.map((r) => mapLedgerRow(r, nighthawkEcho, liveMarks.get(r.ticker.toUpperCase()) ?? null)),
    covered_elsewhere: nighthawk_covered,
  }) as ZeroDteBoardPayload;

  // roundFloats() rounds entry_premium/last_mark independently; recompute PnL from the
  // member-visible rounded premiums so live_pnl_pct always matches (mark-entry)/entry —
  // except a stopped play, whose result is PINNED to the stop P&L (D-1 fix; matches
  // what gradePlanFromBars will stamp after the session).
  return {
    ...payload,
    ledger: payload.ledger.map((row) => ({
      ...row,
      live_pnl_pct:
        row.closed_reason === "stopped"
          ? PLAN_RULES.stop_pct
          : pinnedLivePnlPct(row.entry_premium, row.last_mark),
    })),
  };
}

/** Cached board read — shared by the member route and Largo/BIE consumers. */
export async function getZeroDteBoardPayload(): Promise<ZeroDteBoardPayload> {
  return withServerCache("zerodte:board:v1", BOARD_TTL_MS, buildZeroDteBoardPayload);
}

/** Largo / BIE tool shape — derived from the same board payload the UI polls. */
export async function zeroDtePlaysForLargo(): Promise<Record<string, unknown>> {
  const board = await getZeroDteBoardPayload();
  const { hour, minute } = etNowParts();
  const nowEtMinutes = hour * 60 + minute;
  const byTicker = new Map(board.setups.map((s) => [s.ticker, s]));

  const plays = board.ledger.map((r) => {
    const setup = byTicker.get(r.ticker) ?? null;
    const status = (["OPEN", "HOLD", "TRIM", "CLOSED"].includes(r.status ?? "") ? r.status : "HOLD") as
      | "OPEN"
      | "HOLD"
      | "TRIM"
      | "CLOSED";
    const intel = buildIntelNote({
      status,
      setup,
      plan: setup?.plan ?? null,
      entryPremium: r.entry_premium,
      livePnlPct: r.live_pnl_pct,
      planOutcome: r.plan_outcome,
      planPnlPct: r.plan_pnl_pct,
      nowEtMinutes,
      lastMark: r.last_mark,
    });
    return {
      ticker: r.ticker,
      direction: r.direction,
      strike: r.top_strike,
      status,
      entry_premium: r.entry_premium,
      last_mark: r.last_mark,
      live_pnl_pct: r.live_pnl_pct,
      peak_score: r.score_max,
      action: intel.action,
      intel: intel.reason,
      graded: r.plan_outcome ? { outcome: r.plan_outcome, pnl_pct: r.plan_pnl_pct } : null,
    };
  });

  // Same time-of-day gate ZeroDteBoard.tsx's mergePlays() applies to fresh (not-
  // yet-ledgered) finds — without it, a find surfacing during POWER_HOUR/LATE_SESSION
  // (or after CLOSED, before the ledger sync catches up) got told to Largo as a plain
  // "OPEN" → buildIntelNote returns action:"ADD", an active buy recommendation — even
  // though the product rule (this function's own `rules` string below) is "no new
  // plays after 15:00 ET" and the board itself would show it as SKIP/watch-only.
  const heatState = board.session.heat.state;
  const sessionClosed = heatState === "CLOSED";
  const fresh = sessionClosed
    ? []
    : board.setups
        .filter((s) => !board.ledger.some((row) => row.ticker === s.ticker))
        .slice(0, 5)
        .map((s) => {
          const moved = s.plan?.entry_status === "MOVED";
          // Hard-gate-blocked finds are SKIP regardless of clock/liquidity — the gate
          // stack (src/lib/zerodte/gates.ts) already decided this is not committable,
          // and Largo must never read a blocked find as an actionable "OPEN".
          const status =
            s.gate?.verdict === "BLOCKED"
              ? "SKIP"
              : resolveFreshFindStatus(heatState, moved, Boolean(s.plan?.illiquid));
          return {
            ticker: s.ticker,
            direction: s.direction,
            strike: s.top_strike,
            score: s.score,
            gross_premium: s.gross_premium,
            aggression: s.aggression,
            plan: s.plan,
            // Machine code + human sentence per failing gate (null = clear/ungated) —
            // the same copy the board's SKIP cards render.
            gate_blocks: s.gate?.verdict === "BLOCKED" ? s.gate.blocks : null,
            intel: buildIntelNote({
              status,
              setup: s,
              plan: s.plan,
              entryPremium: s.plan?.entry_max ?? s.top_strike_avg_fill,
              livePnlPct: null,
              planOutcome: null,
              planPnlPct: null,
              nowEtMinutes,
              lastMark: s.plan?.mark ?? null,
            }).reason,
          };
        });

  return {
    source: "0DTE Command (always-on scanner, /grid)",
    session_date: board.session.date,
    plays,
    fresh_finds: fresh,
    excluded_covered_elsewhere: board.covered_elsewhere,
    rules: "0DTE discipline: no new plays after 15:00 ET; stop -50%, trim +100%, hard exit 15:30 ET.",
  };
}
