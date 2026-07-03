// 0DTE Command scanner — the ALWAYS-ON half of the board. The same pipeline runs
// two ways: the grid-warm cron calls warmZeroDteBoard() every ~2 min through RTH
// (so the system hunts all session even when nobody is looking), and the board
// route calls scanZeroDteBoard() on member polls (collapsed to one build per 5s).
// Every qualifying find is upserted into the zerodte_setup_log ledger and graded
// against the session close afterwards — the board's discovery record is measured,
// not asserted.
//
// Mandate (product rule): this surface finds NEW plays. Index products (SPY/SPX/
// NDX/QQQ…) ARE eligible — the dominance gate naturally admits them only when
// their normally two-sided tape genuinely leans. Any ticker in the latest Night
// Hawk edition is excluded — a name members already have is a repeat, not a find.
// 0DTE discipline: no NEW plays after the 15:00 ET cutoff; everything is managed
// to a close by 15:30 ET — nothing carries overnight.

import {
  dbConfigured,
  fetchLatestNighthawkEdition,
  fetchRecentFlows,
  fetchUngradedZeroDteRows,
  fetchZeroDteSetupLog,
  gradeZeroDteSetupRow,
  updateZeroDteLiveState,
  updateZeroDtePlanOutcome,
  upsertZeroDteSetupLog,
  type ZeroDteSetupLogRow,
  type ZeroDteSetupLogUpsert,
} from "@/lib/db";
import { LEVERAGED_ETP_SET } from "@/lib/nighthawk/constants";
import { createDossierBuildCache, fetchTickerDossier } from "@/lib/nighthawk/dossier";
import { etNowParts, todayEt } from "@/lib/nighthawk/session";
import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { buildOcc } from "@/lib/ws/options-socket";
import { withServerCache } from "@/lib/server-cache";
import {
  computeLedgerGrade,
  deriveZeroDteSetups,
  enrichSetup,
  type EarningsFlag,
  type EnrichedZeroDteSetup,
  type NewsHeat,
  type SetupDossierView,
} from "./board";
import {
  buildContractPlan,
  derivePlayStatus,
  gradePlanFromBars,
  NEW_PLAY_CUTOFF_ET_MINUTES,
  type PlanBar,
} from "./plan";

/** Leveraged/inverse wrappers and vol ETPs stay out (not directional single plays);
 *  index products (SPY/SPX/NDX/QQQ…) are eligible per product direction. Night
 *  Hawk's tickers are added per-scan. */
const STATIC_EXCLUDES = new Set<string>([...LEVERAGED_ETP_SET, "VIX", "UVXY"]);

/** Top finds get the full Night Hawk dossier — capped to stay inside UW budgets. */
const ENRICH_TOP_N = 5;
const DOSSIER_CACHE_TTL_MS = 10 * 60 * 1000;
/** How long a caller waits for a COLD dossier before serving the un-enriched setup.
 *  The cache loader keeps running after we stop waiting, so the next scan (~2 min)
 *  or poll (~15s) gets the enriched row instantly — the board "heats up". */
const ENRICH_WAIT_MS = 3_000;

/** Await `p` for at most `ms`, else null — without cancelling `p` (it continues in
 *  the background and populates the server cache). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

export type ZeroDteScanResult = {
  setups: EnrichedZeroDteSetup[];
  /** Tickers withheld because Night Hawk already published them (latest edition). */
  nighthawk_covered: string[];
};

/**
 * The discovery pipeline: HELIX tape → per-ticker aggregation with evidence gates →
 * Night Hawk dedupe → full-dossier enrichment for the top finds. Regime context is
 * intentionally null: the intraday board wants the raw factor read, not the evening
 * regime multiplier.
 */
export async function scanZeroDteBoard(flags?: {
  earnings?: Map<string, EarningsFlag>;
  news?: Map<string, NewsHeat>;
}): Promise<ZeroDteScanResult> {
  const today = todayEt();
  const [flows, nhEdition] = await Promise.all([
    // max_dte: 1 is LOAD-BEARING — it scopes the premium ranking to 0-1DTE prints in
    // SQL. Without it the top-400 spans ALL expiries and heavy-day whale prints crowd
    // every 0DTE print out of the scan's input (live-reproduced: $3.1M AAPL stack → 0 setups).
    fetchRecentFlows({ since_hours: 7, min_premium: 150_000, order: "premium", limit: 400, max_dte: 1 }).catch(
      () => []
    ),
    fetchLatestNighthawkEdition().catch(() => null),
  ]);

  const nighthawkCovered = Array.from(
    new Set(
      (Array.isArray(nhEdition?.plays) ? nhEdition!.plays : [])
        .map((p) => String((p as Record<string, unknown>)?.ticker ?? "").toUpperCase())
        .filter(Boolean)
    )
  );
  const excludes = new Set<string>([...STATIC_EXCLUDES, ...nighthawkCovered]);

  const rawSetups = deriveZeroDteSetups(
    flows.map((f) => ({
      ticker: f.ticker,
      premium: f.premium,
      option_type: f.option_type,
      strike: f.strike,
      expiry: f.expiry,
      dte: f.dte,
      alert_rule: f.alert_rule,
      ask_pct: f.ask_pct,
      underlying_price: f.underlying_price,
      fill_price: f.fill_price,
      alerted_at: f.alerted_at,
    })),
    { maxSetups: 10, excludeTickers: excludes, nowMs: Date.now(), todayYmd: today }
  );

  const buildCache = createDossierBuildCache();
  const setups = await Promise.all(
    rawSetups.map(async (setup, i) => {
      const extras = {
        earnings: flags?.earnings?.get(setup.ticker) ?? null,
        news_hot: flags?.news?.get(setup.ticker) ?? null,
      };
      if (i >= ENRICH_TOP_N) return enrichSetup(setup, null, extras);
      // Single-flight per ticker per 10-min window across all pollers AND the cron
      // warmer (Redis-backed), so nothing multiplies dossier builds.
      const dossier = await within(
        withServerCache<SetupDossierView>(
          `zerodte:dossier:${setup.ticker}:${today}`,
          DOSSIER_CACHE_TTL_MS,
          () => fetchTickerDossier(setup.ticker, null, buildCache)
        ),
        ENRICH_WAIT_MS
      );
      return enrichSetup(setup, dossier, extras);
    })
  );

  await attachContractPlans(setups);

  return { setups, nighthawk_covered: nighthawkCovered };
}

/** One batched quote snapshot for every find's top-strike contract, then a pure
 *  plan per find. Soft-deadlined: a slow quote provider degrades to evidence-only
 *  cards (plan stays null), never a stalled scan. */
async function attachContractPlans(setups: EnrichedZeroDteSetup[]): Promise<void> {
  const occOf = new Map<string, string>();
  for (const s of setups) {
    const occ = buildOcc(s.ticker, s.expiry, s.direction === "long" ? "call" : "put", s.top_strike);
    if (occ) occOf.set(s.ticker, occ);
  }
  if (occOf.size === 0) return;
  const snaps = await within(
    fetchOptionsUnifiedSnapshot(Array.from(occOf.values())).catch(
      () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
    ),
    2_500
  );
  if (!snaps) return;
  for (const s of setups) {
    const occ = occOf.get(s.ticker);
    if (!occ) continue;
    const snap = snaps.get(occ) ?? null;
    // No live quote AND no real fill → no plan (evidence only) — never a guess.
    if (!snap?.mark && s.top_strike_avg_fill == null) continue;
    s.plan = buildContractPlan({
      occ,
      direction: s.direction,
      price: s.underlying_price ?? snap?.underlyingPrice ?? null,
      flowAvgFill: s.top_strike_avg_fill,
      bid: snap?.bid ?? null,
      ask: snap?.ask ?? null,
      mark: snap?.mark ?? null,
      keySupports: s.key_supports,
      keyResistances: s.key_resistances,
      vwap: s.vwap,
    });
  }
}

/** Persist a scan's finds into the session ledger (no-op without a database).
 *  After the 15:00 ET cutoff only EXISTING plays are refreshed — a fresh flag in
 *  power hour never opens a new 0DTE play. */
export async function persistZeroDteScan(setups: EnrichedZeroDteSetup[]): Promise<number> {
  if (!dbConfigured() || setups.length === 0) return 0;
  const today = todayEt();
  const { hour, minute } = etNowParts();
  let eligible = setups;
  if (hour * 60 + minute >= NEW_PLAY_CUTOFF_ET_MINUTES) {
    const existing = new Set((await fetchZeroDteSetupLog(today).catch(() => [])).map((r) => r.ticker));
    eligible = setups.filter((s) => existing.has(s.ticker));
    if (eligible.length === 0) return 0;
  }
  const rows: ZeroDteSetupLogUpsert[] = eligible.map((s) => ({
    session_date: today,
    ticker: s.ticker,
    direction: s.direction,
    top_strike: s.top_strike ?? null,
    expiry: s.expiry || null,
    score: s.score,
    dossier_score: s.dossier_score,
    conviction: s.conviction,
    gross_premium: s.gross_premium,
    spike: s.spike,
    underlying: s.underlying_price,
    // Premium reference the plan grades against: live mark at flag, else the
    // flow's own average fill.
    entry_premium: s.plan?.mark ?? s.top_strike_avg_fill ?? null,
    flow_avg_fill: s.top_strike_avg_fill,
    plan_json: s.plan ? ({ ...s.plan } as unknown as Record<string, unknown>) : null,
    flags_json: {
      ...(s.earnings ? { earnings: s.earnings } : {}),
      ...(s.news_hot ? { news_hot: s.news_hot.title } : {}),
      ...(s.halted ? { halted: true } : {}),
      ...(s.fib_note ? { fib: s.fib_note.label } : {}),
      ...(s.direction_confirmed != null ? { dossier_agrees: s.direction_confirmed } : {}),
    },
  }));
  await upsertZeroDteSetupLog(rows);
  return rows.length;
}

// Lazy grading throttle — grading is idempotent and cheap (≤12 rows × 1 daily-bar
// call), but there is no reason to attempt it more than once per interval per replica.
let lastGradeAttemptMs = 0;
const GRADE_ATTEMPT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Grade ungraded ledger rows from FINISHED sessions against their official close
 * (Polygon daily bar for that exact date). Lazy: called opportunistically from the
 * scan warm and board builds — no dedicated cron needed.
 */
export async function gradeZeroDteLedger(force = false): Promise<number> {
  if (!dbConfigured()) return 0;
  const now = Date.now();
  if (!force && now - lastGradeAttemptMs < GRADE_ATTEMPT_INTERVAL_MS) return 0;
  lastGradeAttemptMs = now;

  const today = todayEt();
  const ungraded = await fetchUngradedZeroDteRows(today).catch(() => [] as ZeroDteSetupLogRow[]);
  let graded = 0;
  for (const row of ungraded) {
    try {
      // Plan grade FIRST (against the contract's own minute bars), then the
      // direction grade — gradeZeroDteSetupRow stamps graded_at, which removes the
      // row from future passes, so everything must land in this one try.
      const occ = typeof row.plan_json?.occ === "string" ? row.plan_json.occ : null;
      if (row.plan_outcome == null && occ && row.entry_premium != null && row.entry_premium > 0) {
        const optBars = await fetchAggBars(occ, 1, "minute", row.session_date, row.session_date, "50000");
        const planBars: PlanBar[] = optBars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c }));
        const planGrade = gradePlanFromBars(planBars, row.entry_premium, Date.parse(row.first_flagged_at));
        await updateZeroDtePlanOutcome(row.session_date, row.ticker, {
          plan_outcome: planGrade.outcome,
          plan_pnl_pct: planGrade.pnl_pct,
        });
      }
      const bars = await fetchAggBars(row.ticker, 1, "day", row.session_date, row.session_date);
      const close = bars.length ? bars[bars.length - 1]!.c : null;
      const grade = computeLedgerGrade(row.direction, row.underlying_at_flag, close ?? null);
      await gradeZeroDteSetupRow(row.session_date, row.ticker, grade);
      graded += 1;
    } catch {
      // Leave the row ungraded — the next lazy pass retries it.
    }
  }
  return graded;
}

/**
 * Cron entry (piggybacked on grid-warm, ~every 2 min through RTH): run the scan,
 * persist finds to the ledger, opportunistically grade past sessions. Returns a
 * small summary object (grid-warm counts a non-null result as a successful warm).
 */
export async function warmZeroDteBoard(): Promise<{ found: number; logged: number } | null> {
  const { setups } = await scanZeroDteBoard();
  const logged = await persistZeroDteScan(setups).catch(() => 0);
  // Keep every live play's OPEN/HOLD/TRIM/CLOSED state fresh even when nobody is
  // watching — the guidance runs on the cron, not on page views.
  await readZeroDteLedger().then(syncLedgerLiveState).catch(() => {});
  void gradeZeroDteLedger().catch(() => {});
  return { found: setups.length, logged };
}

/** Today's ledger for the board's "flagged today" lane (empty without a database). */
export async function readZeroDteLedger(): Promise<ZeroDteSetupLogRow[]> {
  if (!dbConfigured()) return [];
  return fetchZeroDteSetupLog(todayEt()).catch(() => []);
}

/**
 * Refresh every live play's lifecycle state from one batched quote snapshot:
 * latch peak/trough of the mark, derive OPEN/HOLD/TRIM/CLOSED (sticky stop via
 * trough), persist, and return the rows with fresh values for the payload.
 * Already-CLOSED rows are left untouched. Best-effort throughout.
 */
export async function syncLedgerLiveState(rows: ZeroDteSetupLogRow[]): Promise<ZeroDteSetupLogRow[]> {
  const live = rows.filter(
    (r) => r.status !== "CLOSED" && r.entry_premium != null && typeof r.plan_json?.occ === "string"
  );
  if (live.length === 0) return rows;
  const snaps = await within(
    fetchOptionsUnifiedSnapshot(live.map((r) => r.plan_json!.occ as string)).catch(
      () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
    ),
    2_500
  );
  if (!snaps) return rows;
  const { hour, minute } = etNowParts();
  const nowEtMinutes = hour * 60 + minute;

  const updated = await Promise.all(
    rows.map(async (r) => {
      if (r.status === "CLOSED" || r.entry_premium == null || typeof r.plan_json?.occ !== "string") return r;
      const mark = snaps.get(r.plan_json.occ as string)?.mark ?? null;
      const peak = Math.max(r.peak_premium ?? r.entry_premium, mark ?? 0);
      const trough = Math.min(r.trough_premium ?? r.entry_premium, mark ?? Number.MAX_VALUE);
      const state = derivePlayStatus({
        entryPremium: r.entry_premium,
        mark: mark ?? r.last_mark,
        peak,
        trough,
        nowEtMinutes,
      });
      if (dbConfigured()) {
        await updateZeroDteLiveState(r.session_date, r.ticker, { status: state.status, mark }).catch(() => {});
      }
      return { ...r, status: state.status, last_mark: mark ?? r.last_mark, peak_premium: peak, trough_premium: trough };
    })
  );
  return updated;
}
