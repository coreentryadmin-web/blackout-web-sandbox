// 0DTE Command board — pure aggregation logic. Composes the EXISTING graded engines
// (SPX play / lotto / power hour) and the live HELIX tape into one ranked intraday
// board. Deliberately deterministic and read-only: full plays (entry/stop/target)
// come ONLY from the engines that already grade themselves into the track record;
// single-name flow reads are surfaced as SETUPS (direction + strike + evidence),
// never as fabricated entries — the same honesty rule the rest of the desk follows.
//
// Everything here is a pure function of its inputs (rows, clock) so it is unit-
// testable without providers; the API route does the fetching.

export type SessionHeatState =
  | "PRE_MARKET" // before 9:30 ET — system warming: feeds, morning confirm, lotto scan
  | "OPENING_DRIVE" // 9:30-10:00 ET — heating up: ranges forming, engines arming
  | "RTH" // 10:00-15:00 ET — fully hot
  | "POWER_HOUR" // 15:00-15:30 ET — power-hour engine window
  | "LATE_SESSION" // 15:30-16:00 ET — winding down, no fresh entries
  | "CLOSED"; // outside RTH — hand off to Night Hawk

export type SessionHeat = {
  state: SessionHeatState;
  label: string;
  /** 0-100 "how hot is the desk" meter for the header visual. */
  heat_pct: number;
  note: string;
};

/** ET clock → heat state. `etMinutes` = minutes since midnight ET; weekday/holiday
 *  gating happens upstream (callers pass isTradingDay). */
export function sessionHeat(etMinutes: number, isTradingDay: boolean): SessionHeat {
  if (!isTradingDay) {
    return {
      state: "CLOSED",
      label: "Market closed",
      heat_pct: 0,
      note: "No session today — Night Hawk's evening playbook covers the next open.",
    };
  }
  const OPEN = 9 * 60 + 30;
  const TEN = 10 * 60;
  const PH = 15 * 60;
  const PH_END = 15 * 60 + 30;
  const CLOSE = 16 * 60;

  if (etMinutes < OPEN) {
    // Ramp 0→40 across the 2h before the open so the meter visibly "warms".
    const ramp = Math.max(0, Math.min(1, (etMinutes - (OPEN - 120)) / 120));
    return {
      state: "PRE_MARKET",
      label: "Warming up",
      heat_pct: Math.round(40 * ramp),
      note: "Pre-market: feeds warming, overnight plays confirming, lotto scan pending.",
    };
  }
  if (etMinutes < TEN) {
    return {
      state: "OPENING_DRIVE",
      label: "Opening drive",
      heat_pct: 70,
      note: "Ranges forming — engines arming. Best entries usually come after 9:50.",
    };
  }
  if (etMinutes < PH) {
    return {
      state: "RTH",
      label: "Desk hot",
      heat_pct: 100,
      note: "All engines live — plays fire when gates align.",
    };
  }
  if (etMinutes < PH_END) {
    return {
      state: "POWER_HOUR",
      label: "Power hour",
      heat_pct: 100,
      note: "Power-hour engine window — closing-drive setups.",
    };
  }
  if (etMinutes < CLOSE) {
    return {
      state: "LATE_SESSION",
      label: "Winding down",
      heat_pct: 50,
      note: "Late session — managing open risk, no fresh entries.",
    };
  }
  return {
    state: "CLOSED",
    label: "Session closed",
    heat_pct: 0,
    note: "Session done — Night Hawk builds tomorrow's playbook after the close.",
  };
}

// ── Single-name 0DTE flow setups (evidence, not fabricated plays) ────────────────

export type FlowSetupInput = {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  expiry: string;
  dte?: number;
  alert_rule?: string;
  ask_pct?: number;
  underlying_price?: number;
  /** Per-contract fill price the print actually paid (UW alert `price`). */
  fill_price?: number;
  /** Open interest on the contract at alert time — sizes "new money" vs closing. */
  open_interest?: number;
  alerted_at: string;
};

export type ZeroDteSetup = {
  ticker: string;
  direction: "long" | "short";
  /** Dominant strike by premium on the dominant side. */
  top_strike: number;
  expiry: string;
  dte: number;
  net_premium: number;
  gross_premium: number;
  prints: number;
  sweep_pct: number;
  /** Premium-weighted dominance of the winning side (0.5-1). */
  side_dominance: number;
  underlying_price: number | null;
  /** 0-100 deterministic evidence score (premium tiers + sweeps + dominance + breadth). */
  score: number;
  /** Premium-weighted avg per-contract fill on the top strike — what flow PAID. */
  top_strike_avg_fill: number | null;
  /** Premium-weighted share of the tape that traded AT THE ASK (0-1; aggressive buying). */
  aggression: number | null;
  /** Top strike's distance from spot, % — positive = OTM, negative = ITM. */
  otm_pct: number | null;
  /** Share of top-strike flow that exceeds existing OI — opening positioning, not closing. */
  new_money: boolean;
  /** Premium that landed in the last 30 minutes of the observed tape. */
  recent_premium_30m: number;
  /** Sudden-flow-spike flag: ≥half the ticker's whole tape arrived in the last 30m. */
  spike: boolean;
  first_seen: string | null;
  last_seen: string | null;
};

// Exported so the audit trail (buildZeroDteAuditRow below) can cite the actual
// live gate thresholds instead of a second, driftable copy of these numbers.
export const SETUP_MIN_GROSS = 750_000; // ignore thin names — this is a "best of the tape" board
export const SETUP_MIN_DOMINANCE = 0.65; // two-sided tape is a fade signal, not a setup
const SETUP_MAX_DTE = 1; // 0DTE board: today + tomorrow expiries only
/** Aggressive (at-the-ask) share of the tape must be meaningful — a tape of SOLD
 *  premium (bid-side prints) is income harvesting, not directional conviction. */
export const SETUP_MIN_AGGR_SHARE = 0.3;
/** Top strike more than this % IN the money = stock replacement, not a directional
 *  0DTE bet — the SNDK 1880p-at-1723 class of fake-out. */
export const SETUP_MAX_ITM_PCT = 2;

/** How much of a print's premium counts DIRECTIONALLY, by aggressor side.
 *  At/near the ask = conviction buying; bid-side = sold premium (opposite intent);
 *  unknown = partial credit so thin metadata doesn't zero the board. */
function aggressionWeight(askPct: number | null | undefined): number {
  if (askPct == null || !Number.isFinite(askPct)) return 0.7;
  if (askPct >= 60) return 1;
  if (askPct >= 45) return 0.6;
  return 0.15;
}

// ── Gate-rejection / near-miss capture (task #147) ────────────────────────────────
// deriveZeroDteSetups below evaluates 4 real gates per aggregated candidate ticker
// (SETUP_MIN_GROSS, SETUP_MIN_AGGR_SHARE, SETUP_MIN_DOMINANCE, SETUP_MAX_ITM_PCT) —
// plus two defensive structural guards: a dominant side with premium but somehow no
// strike on record (practically unreachable in real data), and a candidate whose tape
// never carried a usable underlying price (see no_underlying_price below — NOT
// practically unreachable; UW alert payloads can legitimately omit it) — and
// `continue`s straight past any candidate that fails one, with nothing surviving past
// that loop iteration.
// This type + the optional `opts.rejections` out-array below let a caller durably
// record exactly what was known about a candidate AT THE POINT it was rejected — no
// more, no less. A rejection at an EARLIER gate genuinely never computes the LATER
// gates' metrics (the real scan short-circuits there too), so this deliberately
// leaves those fields `null` rather than back-filling a full recompute the live scan
// itself never performs — the same "never fabricate a reading that wasn't actually
// evaluated" discipline this codebase applies to shadow-factor availability.
export type ZeroDteGateFailure =
  | "min_gross"
  | "min_aggr_share"
  | "min_dominance"
  | "max_itm_pct"
  | "no_dominant_strike"
  | "no_underlying_price";

export type ZeroDteGateRejection = {
  ticker: string;
  gate_failed: ZeroDteGateFailure;
  /** The real threshold constant this candidate was measured against (cited live,
   *  same discipline buildZeroDteAuditRow uses, so a future threshold tune can't
   *  retroactively relabel a historical rejection). `null` for the structural
   *  no_dominant_strike/no_underlying_price guards, which have no numeric threshold. */
  threshold: number | null;
  gross_premium: number;
  /** Null when the scan never reached the aggression-share gate for this candidate. */
  aggression: number | null;
  /** Null when the scan never reached the dominance gate for this candidate. */
  side_dominance: number | null;
  /** Null when the scan never reached the moneyness gate — including a
   *  no_underlying_price rejection, since that IS the moneyness gate failing closed
   *  on unreadable data (P0 fix: previously an unknown underlying price silently
   *  SKIPPED this gate instead of failing it — see SETUP_MAX_ITM_PCT below). */
  otm_pct: number | null;
  /** The dominant side's lean, once the scan gets far enough to compute it (gate C
   *  onward). Null for a min_gross/min_aggr_share rejection — the real scan does not
   *  know a direction at that point either. */
  direction: "long" | "short" | null;
  prints: number;
  first_seen: string | null;
  last_seen: string | null;
};

/**
 * Derive ranked single-name setups from HELIX tape rows. Index products should be
 * excluded upstream (SPX has its own engines on this board).
 *
 * `opts.rejections`, when supplied, is an accumulator this function pushes a
 * `ZeroDteGateRejection` into for every candidate ticker that fails a gate — purely
 * additive (mutates the caller's array; never read from, never affects `setups`) and
 * a complete no-op when omitted, so every existing caller/test that doesn't pass it
 * sees zero behavior or allocation change. See the module doc above the type for why
 * the captured data is necessarily partial per gate.
 */
export function deriveZeroDteSetups(
  rows: FlowSetupInput[],
  opts?: {
    maxSetups?: number;
    excludeTickers?: Set<string>;
    nowMs?: number;
    todayYmd?: string;
    rejections?: ZeroDteGateRejection[];
  }
): ZeroDteSetup[] {
  const maxSetups = opts?.maxSetups ?? 8;
  type Agg = {
    call: number;
    put: number;
    /** Aggression-weighted (at-the-ask) sums — what the DIRECTIONAL read uses. */
    callAggr: number;
    putAggr: number;
    aggrWeighted: number;
    sweep: number;
    gross: number;
    prints: number;
    strikes: Map<string, { prem: number; strike: number; expiry: number; isCall: boolean; fillPrem: number; fillW: number; contracts: number; oi: number }>;
    underlying: number | null;
    /** alerted_at of the print that supplied `underlying` — keep only the freshest. */
    underlyingSeen: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
    minDte: number;
    /** (epoch-ms, premium) per print — for the sudden-spike read. */
    stamps: Array<[number, number]>;
  };
  const byTicker = new Map<string, Agg>();

  for (const r of rows) {
    const ticker = r.ticker?.toUpperCase();
    if (!ticker || opts?.excludeTickers?.has(ticker)) continue;
    const dte = r.dte ?? null;
    if (dte == null || dte > SETUP_MAX_DTE || dte < 0) continue;
    // dte was stamped at ALERT time — a 0DTE print from a prior session (the tape
    // window can straddle sessions) is an EXPIRED contract today, not a setup.
    // Both sides are YYYY-MM-DD, so lexicographic compare is date compare.
    if (opts?.todayYmd && r.expiry && r.expiry.slice(0, 10) < opts.todayYmd) continue;
    const prem = r.premium;
    if (!(prem > 0)) continue;

    const agg =
      byTicker.get(ticker) ??
      ({
        call: 0,
        put: 0,
        callAggr: 0,
        putAggr: 0,
        aggrWeighted: 0,
        sweep: 0,
        gross: 0,
        prints: 0,
        strikes: new Map(),
        underlying: null,
        underlyingSeen: null,
        firstSeen: null,
        lastSeen: null,
        minDte: SETUP_MAX_DTE,
        stamps: [],
      } as Agg);

    const isCall = (r.option_type ?? "").toLowerCase().startsWith("c");
    const w = aggressionWeight(r.ask_pct);
    if (isCall) {
      agg.call += prem;
      agg.callAggr += prem * w;
    } else {
      agg.put += prem;
      agg.putAggr += prem * w;
    }
    agg.aggrWeighted += prem * w;
    agg.gross += prem;
    agg.prints += 1;
    if ((r.alert_rule ?? "").toLowerCase().includes("sweep")) agg.sweep += prem;
    // Rows arrive premium-ordered, not time-ordered — last-write-wins here used to
    // pin `underlying` to whatever print happened to be processed last (often hours
    // stale), skewing the fib/level annotations. Keep the freshest print's mark.
    if (r.underlying_price && r.underlying_price > 0) {
      if (!agg.underlyingSeen || (r.alerted_at && r.alerted_at > agg.underlyingSeen)) {
        agg.underlying = r.underlying_price;
        agg.underlyingSeen = r.alerted_at ?? agg.underlyingSeen;
      }
    }
    agg.minDte = Math.min(agg.minDte, dte);
    const key = `${r.strike}|${r.expiry}|${isCall ? "c" : "p"}`;
    const cur = agg.strikes.get(key) ?? { prem: 0, strike: r.strike, expiry: Date.parse(r.expiry) || 0, isCall, fillPrem: 0, fillW: 0, contracts: 0, oi: 0 };
    cur.prem += prem;
    // Premium-weighted per-contract fill — "what did the flow actually pay here".
    if (r.fill_price && r.fill_price > 0) {
      cur.fillPrem += r.fill_price * prem;
      cur.fillW += prem;
      // Implied contracts traded (premium / (fill × 100)) vs the strike's OI —
      // flow bigger than existing OI is OPENING positioning, not closing.
      cur.contracts += prem / (r.fill_price * 100);
    }
    if (r.open_interest && r.open_interest > 0) cur.oi = Math.max(cur.oi, r.open_interest);
    agg.strikes.set(key, cur);
    if (r.alerted_at) {
      if (!agg.firstSeen || r.alerted_at < agg.firstSeen) agg.firstSeen = r.alerted_at;
      if (!agg.lastSeen || r.alerted_at > agg.lastSeen) agg.lastSeen = r.alerted_at;
      const ts = Date.parse(r.alerted_at);
      if (Number.isFinite(ts)) agg.stamps.push([ts, prem]);
    }
    byTicker.set(ticker, agg);
  }

  // "Now" for the spike window: caller-supplied, else the newest print observed —
  // keeps the function pure/deterministic and naturally cools spikes off as the
  // tape ages past the window.
  const nowMs =
    opts?.nowMs ??
    Math.max(0, ...Array.from(byTicker.values()).flatMap((a) => a.stamps.map(([ts]) => ts)));
  const SPIKE_WINDOW_MS = 30 * 60 * 1000;

  const setups: ZeroDteSetup[] = [];
  for (const [ticker, agg] of Array.from(byTicker.entries())) {
    if (agg.gross < SETUP_MIN_GROSS) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "min_gross",
        threshold: SETUP_MIN_GROSS,
        gross_premium: agg.gross,
        aggression: null,
        side_dominance: null,
        otm_pct: null,
        direction: null,
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    // Aggressor filter: direction is read from AT-THE-ASK premium only. A tape of
    // sold premium (low aggressive share) is harvesting, not conviction — skip it.
    const aggrTotal = agg.callAggr + agg.putAggr;
    const aggression = agg.gross > 0 ? agg.aggrWeighted / agg.gross : 0;
    if (aggrTotal <= 0 || aggression < SETUP_MIN_AGGR_SHARE) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "min_aggr_share",
        threshold: SETUP_MIN_AGGR_SHARE,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: null,
        otm_pct: null,
        direction: null,
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    const dominantCall = agg.callAggr >= agg.putAggr;
    const winning = dominantCall ? agg.callAggr : agg.putAggr;
    const dominance = winning / aggrTotal;
    if (dominance < SETUP_MIN_DOMINANCE) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "min_dominance",
        threshold: SETUP_MIN_DOMINANCE,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: null,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }

    // Dominant strike on the winning side.
    let top: { prem: number; strike: number; expiry: number; fillPrem: number; fillW: number; contracts: number; oi: number } | null = null;
    let topExpiry = "";
    for (const [key, s] of Array.from(agg.strikes.entries())) {
      if (s.isCall !== dominantCall) continue;
      if (!top || s.prem > top.prem) {
        top = s;
        topExpiry = key.split("|")[1] ?? "";
      }
    }
    if (!top) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "no_dominant_strike",
        threshold: null,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: null,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    const avgFill = top.fillW > 0 ? Math.round((top.fillPrem / top.fillW) * 100) / 100 : null;

    // Moneyness: deep-ITM top strike = stock replacement, not a directional 0DTE
    // bet — excluded outright (the fake-out class live-caught on day one). This
    // gate needs a real underlying price to evaluate. P0 FIX: this used to be
    // `if (agg.underlying && agg.underlying > 0) { ...check...}` with NO else —
    // when every print for a ticker's tape came back missing underlying_last/
    // underlying_price/stock_price (a real UW payload gap, not hypothetical), the
    // whole moneyness gate was silently SKIPPED and the candidate fell through to
    // `setups.push(...)` below with `otm_pct: null`, i.e. a deep-ITM stock-
    // replacement print (the exact SNDK 1880p-at-1723 class this gate exists to
    // catch) could reach the live board completely ungated. Worse, a live
    // underlying price is available moments later in scan.ts's attachContractPlans
    // (`snap?.underlyingPrice`) but was never fed back to re-check this gate. Since
    // this product has NO independent verifier (unlike SPX Slayer/Heat Maps), a
    // fail-open gate here is invisible in production. Fixed to fail CLOSED, like
    // every other gate in this function: unknown moneyness is now a rejection, not
    // a free pass.
    if (!(agg.underlying && agg.underlying > 0)) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "no_underlying_price",
        threshold: null,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: null,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    const raw = ((top.strike - agg.underlying) / agg.underlying) * 100;
    const otmPct = Math.round((dominantCall ? raw : -raw) * 100) / 100;
    if (otmPct < -SETUP_MAX_ITM_PCT) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "max_itm_pct",
        threshold: -SETUP_MAX_ITM_PCT,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: otmPct,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    // New money: implied contracts traded on the top strike exceed its OI.
    const newMoney = top.contracts > 0 && top.oi > 0 && top.contracts > top.oi;

    const sweepPct = agg.gross > 0 ? agg.sweep / agg.gross : 0;

    // Sudden flow spike: at least half the ticker's tape (and 4+ prints total)
    // landed inside the last 30 minutes — someone is loading NOW, not drip-buying.
    const recent30 = agg.stamps.reduce(
      (sum, [ts, prem]) => (nowMs - ts <= SPIKE_WINDOW_MS ? sum + prem : sum),
      0
    );
    const spike = agg.prints >= 4 && agg.gross > 0 && recent30 / agg.gross >= 0.5;

    // Evidence score: premium tiers (0-40) + dominance (0-25) + sweeps (0-20) + prints (0-15)
    // + spike urgency (0-5).
    let score = 0;
    if (agg.gross >= 10_000_000) score += 40;
    else if (agg.gross >= 5_000_000) score += 32;
    else if (agg.gross >= 2_000_000) score += 24;
    else if (agg.gross >= 1_000_000) score += 16;
    else score += 8;
    score += Math.round(((dominance - 0.5) / 0.5) * 25);
    score += Math.round(sweepPct * 20);
    score += Math.min(15, agg.prints);
    if (spike) score += 5;
    // Conviction quality: heavy at-the-ask share and opening (new-money) flow.
    score += Math.round(Math.max(0, aggression - 0.5) * 20); // 0-10
    if (newMoney) score += 5;

    setups.push({
      ticker,
      direction: dominantCall ? "long" : "short",
      top_strike: top.strike,
      top_strike_avg_fill: avgFill,
      expiry: topExpiry,
      dte: agg.minDte,
      net_premium: Math.round(agg.callAggr - agg.putAggr),
      gross_premium: agg.gross,
      prints: agg.prints,
      sweep_pct: Math.round(sweepPct * 100) / 100,
      side_dominance: Math.round(dominance * 100) / 100,
      underlying_price: agg.underlying,
      score: Math.max(0, Math.min(100, score)),
      aggression: Math.round(aggression * 100) / 100,
      otm_pct: otmPct,
      new_money: newMoney,
      recent_premium_30m: recent30,
      spike,
      first_seen: agg.firstSeen,
      last_seen: agg.lastSeen,
    });
  }

  return setups.sort((a, b) => b.score - a.score).slice(0, maxSetups);
}

// ── Engine card ranking ───────────────────────────────────────────────────────────

export type EngineCard = {
  kind: "spx_play" | "lotto" | "power_hour";
  /** ACTIVE = live managed play; ARMED = ready/near-trigger; SCANNING = watching; DONE/OFF. */
  state: "ACTIVE" | "ARMED" | "SCANNING" | "DONE" | "OFF";
  rank: number;
};

/**
 * Deterministic ordering for the engine cards: an ACTIVE managed play always leads,
 * ARMED engines next (lotto before power-hour outside 15:00-15:30, reversed inside
 * the window), then scanning states.
 */
export function rankEngineCards(
  cards: Array<Omit<EngineCard, "rank">>,
  inPowerHourWindow: boolean
): EngineCard[] {
  const stateOrder: Record<EngineCard["state"], number> = {
    ACTIVE: 0,
    ARMED: 1,
    SCANNING: 2,
    DONE: 3,
    OFF: 4,
  };
  const kindOrder = (k: EngineCard["kind"]): number => {
    if (k === "spx_play") return 0;
    if (inPowerHourWindow) return k === "power_hour" ? 1 : 2;
    return k === "lotto" ? 1 : 2;
  };
  return [...cards]
    .sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || kindOrder(a.kind) - kindOrder(b.kind))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

// ── Dossier enrichment (the "very strong" layer) ─────────────────────────────────
// The top setups get the FULL Night Hawk dossier treatment — the same enrichment +
// direction-correct deterministic scorer the evening edition uses: flow streaks,
// strike stacks, Polygon technicals (breakouts/MA stacks/RSI/rel-vol), dark pool,
// OI change, skew, news/catalysts, analyst PT, congress/institutional, fundamentals.
// This function is the PURE merge of a fetched dossier onto a flow setup, so it is
// unit-testable with a fake dossier; the route does the (cached) fetching.

import { computeFibLevels, nearestFibNote, type FibNote } from "./fib";
import type { ContractPlan } from "./plan";
import type { IntradayRead } from "./intraday";

/** Structural subset of TickerDossier the enrichment reads (keeps this module
 *  provider-import-free and the merge testable with plain objects). */
export type SetupDossierView = {
  tech?: {
    price: number;
    trend: string;
    setup_tags: string[];
    breakout_zones: string[];
    support_levels: number[];
    resistance_levels: number[];
    weekly: { high: number | null; low: number | null };
    prior_day: { high: number | null; low: number | null; close: number | null };
    rsi14: number | null;
    rel_volume: number | null;
    atr14: number | null;
    vwap: number | null;
  } | null;
  dark_pool?: { total_premium?: number; bias?: string } | null;
  /** Dealer positioning on the name (Thermal-class data via the dossier). */
  positioning?: { gex_king_strike?: number | null; gamma_regime?: string; gamma_flip?: number | null } | null;
  flow_streak?: { streak_days: number; direction: "long" | "short" | "mixed" } | null;
  scored?: {
    score: number;
    direction: "long" | "short";
    conviction: string;
    flow_score: number;
    tech_score: number;
    pos_score: number;
    news_score: number;
    smart_money_score: number;
    catalyst_flags?: string[];
  } | null;
  /** Benzinga analyst price-target one-liner (e.g. "PT raised to $210 at MS"). */
  price_target?: string | null;
  trading_halt?: boolean;
};

export type EarningsFlag = {
  when: "premarket" | "afterhours";
  report_date: string | null;
  expected_move_pct: number | null;
};

export type NewsHeat = {
  title: string;
  published: string | null;
  url: string | null;
  minutes_ago: number;
};

export type EnrichedZeroDteSetup = ZeroDteSetup & {
  /** Full deterministic dossier score (0-100) + conviction from the audited scorer. */
  dossier_score: number | null;
  conviction: string | null;
  /** Whether the dossier's flow-lane direction agrees with the live-tape read. */
  direction_confirmed: boolean | null;
  factor_breakdown: {
    flow: number;
    tech: number;
    positioning: number;
    news: number;
    smart_money: number;
  } | null;
  trend: string | null;
  tech_tags: string[];
  breakout_zones: string[];
  /** Nearest chart levels around price: up to 2 supports below, 2 resistances above. */
  key_supports: number[];
  key_resistances: number[];
  vwap: number | null;
  atr14: number | null;
  rsi14: number | null;
  rel_volume: number | null;
  streak_days: number | null;
  dark_pool_bias: string | null;
  /** Dealer gamma king node + regime for the name (from the dossier's positioning). */
  gex_king_strike: number | null;
  gamma_regime: string | null;
  /** Today's minute-bar read (session VWAP, opening range, 5m trend) — scan-attached. */
  intraday: IntradayRead | null;
  /** Hard intraday conflict: wrong side of VWAP AND short-term trend against — A-tier disqualifier. */
  intraday_conflict: boolean;
  /** Play direction vs the SPY tape right now (null = unknown/flat market). */
  market_aligned: boolean | null;
  /** Time-of-day window note (prime window / lunch chop), when one applies. */
  tod_label: string | null;
  catalyst_flags: string[];
  analyst_note: string | null;
  /** Fib annotation vs the weekly swing, when price sits at a level. */
  fib_note: FibNote | null;
  /** Entry/exit contract plan (premium band + exits) — attached by the scan when a
   *  live quote or real fill exists; null = evidence only, never a guessed plan. */
  plan: ContractPlan | null;
  halted: boolean;
  /** Reports today/next session — a 0DTE into an earnings print is a different trade. */
  earnings: EarningsFlag | null;
  /** Fresh headline (<2h) naming this ticker. */
  news_hot: NewsHeat | null;
};

// ── Stage 4 audit trail (alert_audit_log) ─────────────────────────────────────────
// Shape matches the alert_audit_log columns in src/lib/db.ts. Defined here (not in
// db.ts) so the row-building logic is a pure function of a setup + session date —
// unit-testable with fixture setups, no database required.

export type ZeroDteAuditRow = {
  alert_type: "zerodte";
  source_table: "zerodte_setup_log";
  source_key: { session_date: string; ticker: string };
  ticker: string;
  direction: "long" | "short";
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string;
  decision_trace: Array<{ check: string; passed: boolean; value: unknown; threshold: unknown }>;
  input_snapshot: Record<string, unknown>;
  final_output: Record<string, unknown> | null;
};

/** Build the audit-trail row for a setup's FIRST flag. Every setup reaching this
 *  function already cleared the four gates in deriveZeroDteSetups — this only
 *  records that fact (real gate values vs their real thresholds), it never
 *  invents a check that wasn't actually applied. */
export function buildZeroDteAuditRow(setup: EnrichedZeroDteSetup, sessionDate: string): ZeroDteAuditRow {
  return {
    alert_type: "zerodte",
    source_table: "zerodte_setup_log",
    source_key: { session_date: sessionDate, ticker: setup.ticker },
    ticker: setup.ticker,
    direction: setup.direction,
    confidence_score: setup.dossier_score ?? setup.score,
    confidence_label: setup.conviction,
    trigger_reason: setup.spike ? "flow spike (30m surge)" : "dominant aggressor flow",
    decision_trace: [
      { check: "gross_premium_min", passed: setup.gross_premium >= SETUP_MIN_GROSS, value: setup.gross_premium, threshold: SETUP_MIN_GROSS },
      { check: "aggression_share_min", passed: (setup.aggression ?? 0) >= SETUP_MIN_AGGR_SHARE, value: setup.aggression, threshold: SETUP_MIN_AGGR_SHARE },
      { check: "side_dominance_min", passed: setup.side_dominance >= SETUP_MIN_DOMINANCE, value: setup.side_dominance, threshold: SETUP_MIN_DOMINANCE },
      // P0 fix: previously `setup.otm_pct == null || ...` — a null reading (unknown
      // underlying price) was recorded as PASSED. deriveZeroDteSetups now rejects
      // those candidates outright (no_underlying_price), so a setup should never
      // reach this function with a null otm_pct — but the audit trail fails CLOSED
      // on it too, defense-in-depth, rather than assuming that invariant holds.
      { check: "max_itm_pct", passed: setup.otm_pct != null && setup.otm_pct >= -SETUP_MAX_ITM_PCT, value: setup.otm_pct, threshold: -SETUP_MAX_ITM_PCT },
      { check: "intraday_conflict", passed: !setup.intraday_conflict, value: setup.intraday_conflict, threshold: false },
    ],
    input_snapshot: {
      score: setup.score,
      dossier_score: setup.dossier_score,
      gross_premium: setup.gross_premium,
      net_premium: setup.net_premium,
      sweep_pct: setup.sweep_pct,
      prints: setup.prints,
      new_money: setup.new_money,
      spike: setup.spike,
      underlying_price: setup.underlying_price,
      top_strike: setup.top_strike,
      expiry: setup.expiry,
      intraday_conflict: setup.intraday_conflict,
      direction_confirmed: setup.direction_confirmed,
    },
    final_output: setup.plan ? ({ ...setup.plan } as unknown as Record<string, unknown>) : null,
  };
}

/** Tickers reporting on `today` or `nextDay` → earnings flag (per-ticker, first match). */
export function matchEarnings(
  items: Array<{
    ticker: string;
    when: "premarket" | "afterhours";
    report_date: string | null;
    expected_move_pct: number | null;
  }>,
  dates: { today: string; nextDay: string }
): Map<string, EarningsFlag> {
  const out = new Map<string, EarningsFlag>();
  for (const it of items) {
    const ticker = it.ticker?.toUpperCase();
    if (!ticker || out.has(ticker)) continue;
    if (it.report_date !== dates.today && it.report_date !== dates.nextDay) continue;
    out.set(ticker, {
      when: it.when,
      report_date: it.report_date,
      expected_move_pct: it.expected_move_pct,
    });
  }
  return out;
}

/** Freshest headline (within `windowMinutes`) per mentioned ticker. */
export function matchHotNews(
  articles: Array<{ title?: string; published?: string; tickers?: string[]; url?: string }>,
  nowMs: number,
  windowMinutes = 120
): Map<string, NewsHeat> {
  const out = new Map<string, NewsHeat>();
  for (const a of articles) {
    if (!a.title || !a.published || !Array.isArray(a.tickers)) continue;
    const ts = Date.parse(a.published);
    if (!Number.isFinite(ts)) continue;
    const ageMin = (nowMs - ts) / 60_000;
    if (ageMin < 0 || ageMin > windowMinutes) continue;
    for (const t of a.tickers) {
      const ticker = String(t).toUpperCase();
      if (!ticker) continue;
      const prev = out.get(ticker);
      if (!prev || ageMin < prev.minutes_ago) {
        out.set(ticker, {
          title: a.title,
          published: a.published,
          url: a.url ?? null,
          minutes_ago: Math.round(ageMin),
        });
      }
    }
  }
  return out;
}

export function enrichSetup(
  setup: ZeroDteSetup,
  dossier: SetupDossierView | null,
  extras?: { earnings?: EarningsFlag | null; news_hot?: NewsHeat | null }
): EnrichedZeroDteSetup {
  const scored = dossier?.scored ?? null;
  const tech = dossier?.tech ?? null;

  // Weekly-swing fibs, oriented by the setup direction: a long retraces the up-swing
  // (dip-buy levels); a short retraces the down-swing (pop-short levels).
  let fibNote: FibNote | null = null;
  const price = setup.underlying_price ?? tech?.price ?? null;
  if (price && tech?.weekly.high && tech.weekly.low) {
    const levels = computeFibLevels(
      tech.weekly.low,
      tech.weekly.high,
      setup.direction === "long" ? "up" : "down"
    );
    fibNote = nearestFibNote(price, levels);
  }

  // Nearest structure around price: the 2 highest supports below, 2 lowest
  // resistances above — the levels that actually matter for a same-day trade.
  const keySupports =
    price != null
      ? (tech?.support_levels ?? []).filter((l) => l > 0 && l < price).sort((a, b) => b - a).slice(0, 2)
      : [];
  const keyResistances =
    price != null
      ? (tech?.resistance_levels ?? []).filter((l) => l > price).sort((a, b) => a - b).slice(0, 2)
      : [];

  return {
    ...setup,
    dossier_score: scored?.score ?? null,
    conviction: scored?.conviction ?? null,
    direction_confirmed: scored ? scored.direction === setup.direction : null,
    factor_breakdown: scored
      ? {
          flow: scored.flow_score,
          tech: scored.tech_score,
          positioning: scored.pos_score,
          news: scored.news_score,
          smart_money: scored.smart_money_score,
        }
      : null,
    trend: tech?.trend ?? null,
    tech_tags: tech?.setup_tags ?? [],
    breakout_zones: tech?.breakout_zones ?? [],
    key_supports: keySupports,
    key_resistances: keyResistances,
    vwap: tech?.vwap ?? null,
    atr14: tech?.atr14 ?? null,
    rsi14: tech?.rsi14 ?? null,
    rel_volume: tech?.rel_volume ?? null,
    streak_days: dossier?.flow_streak?.streak_days ?? null,
    dark_pool_bias: dossier?.dark_pool?.bias ?? null,
    gex_king_strike: dossier?.positioning?.gex_king_strike ?? null,
    gamma_regime: dossier?.positioning?.gamma_regime ?? null,
    intraday: null,
    intraday_conflict: false,
    market_aligned: null,
    tod_label: null,
    catalyst_flags: scored?.catalyst_flags ?? [],
    analyst_note: dossier?.price_target ?? null,
    fib_note: fibNote,
    plan: null,
    halted: dossier?.trading_halt === true,
    earnings: extras?.earnings ?? null,
    news_hot: extras?.news_hot ?? null,
  };
}

// ── Ledger grading (pure) ─────────────────────────────────────────────────────────
// The scanner logs every flagged setup with the underlying price AT FIRST FLAG; after
// the session, each row is graded against the official close. Pure math here so the
// hit-rate arithmetic is unit-tested — the honesty of the ledger depends on it.

export type LedgerGrade = {
  close_price: number | null;
  /** Signed % move from flag → close, positive = moved WITH the setup's direction. */
  move_pct: number | null;
  direction_hit: boolean | null;
};

export function computeLedgerGrade(
  direction: "long" | "short",
  underlyingAtFlag: number | null,
  closePrice: number | null
): LedgerGrade {
  if (!(underlyingAtFlag != null && underlyingAtFlag > 0) || !(closePrice != null && closePrice > 0)) {
    // No flag price or no close — ungradeable, stamped as such rather than guessed.
    return { close_price: closePrice ?? null, move_pct: null, direction_hit: null };
  }
  const raw = ((closePrice - underlyingAtFlag) / underlyingAtFlag) * 100;
  const signed = direction === "long" ? raw : -raw;
  return {
    close_price: closePrice,
    move_pct: Math.round(signed * 100) / 100,
    direction_hit: signed > 0,
  };
}
