/**
 * 0DTE Command — single source of truth for the live board payload.
 * Member route (/api/market/zerodte/board), Largo (get_zerodte_plays), and BIE
 * composers (composeZeroDtePlays / composeTickerPlayState) all read through here
 * so ledger PnL, intel lines, and Night Hawk dedupe never drift.
 */
import type { ZeroDteSetupLogRow } from "@/lib/db";
import { fetchNighthawkEchoForTickers, type EcosystemNightHawkTake } from "@/lib/bie/ecosystem-context";
import { etNowParts, isTradingDayEt, nextTradingDayEt, todayEt } from "@/lib/nighthawk/session";
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

function livePnlPct(entry: number | null, mark: number | null): number | null {
  if (entry == null || entry <= 0 || mark == null) return null;
  return Math.round(((mark - entry) / entry) * 10000) / 100;
}

function mapLedgerRow(
  r: ZeroDteSetupLogRow,
  nighthawkEcho: Awaited<ReturnType<typeof fetchNighthawkEchoForTickers>>
): ZeroDteBoardLedgerRow {
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
    last_mark: r.last_mark,
    live_pnl_pct: livePnlPct(r.entry_premium, r.last_mark),
    move_pct: r.move_pct,
    direction_hit: r.direction_hit,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct,
    graded: r.graded_at != null,
    nighthawk_echo: nighthawkEcho.get(r.ticker.toUpperCase()) ?? null,
  };
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
  const nighthawkEcho = await fetchNighthawkEchoForTickers(ledgerRows.map((r) => r.ticker));

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
    ledger: ledgerRows.map((r) => mapLedgerRow(r, nighthawkEcho)),
    covered_elsewhere: nighthawk_covered,
  }) as ZeroDteBoardPayload;

  // roundFloats() rounds entry_premium/last_mark independently; recompute PnL from the
  // member-visible rounded premiums so live_pnl_pct always matches (mark-entry)/entry.
  return {
    ...payload,
    ledger: payload.ledger.map((row) => ({
      ...row,
      live_pnl_pct: livePnlPct(row.entry_premium, row.last_mark),
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
          const status = resolveFreshFindStatus(heatState, moved, Boolean(s.plan?.illiquid));
          return {
            ticker: s.ticker,
            direction: s.direction,
            strike: s.top_strike,
            score: s.score,
            gross_premium: s.gross_premium,
            aggression: s.aggression,
            plan: s.plan,
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
