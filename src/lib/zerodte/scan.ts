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
  insertAlertAuditLog,
  updateZeroDteLiveState,
  updateZeroDtePlanOutcome,
  upsertZeroDteSetupLog,
  type ZeroDteSetupLogRow,
  type ZeroDteSetupLogUpsert,
} from "@/lib/db";
import { LEVERAGED_ETP_SET } from "@/features/nighthawk/lib/constants";
import { createDossierBuildCache, fetchTickerDossier } from "@/features/nighthawk/lib/dossier";
import { etNowParts, todayEt } from "@/features/nighthawk/lib/session";
import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { buildOcc } from "@/lib/ws/options-socket";
import { withServerCache } from "@/lib/server-cache";
import {
  buildZeroDteAuditRow,
  computeLedgerGrade,
  deriveZeroDteSetups,
  enrichSetup,
  polygonSpotTicker,
  type EarningsFlag,
  type EnrichedZeroDteSetup,
  type NewsHeat,
  type SetupDossierView,
  type ZeroDteGateRejection,
} from "./board";
import { persistZeroDteRejections } from "./rejections";
import { evaluateZeroDteGates, gateRejectionFor } from "./gates";
import {
  computeIntradayRead,
  intradayScoreAdjust,
  marketAlignAdjust,
  marketBias,
  timeOfDayFactor,
  type IntradayRead,
  type MarketBias,
} from "./intraday";
import {
  buildContractPlan,
  derivePlayStatus,
  gradePlanFromBars,
  NEW_PLAY_CUTOFF_ET_MINUTES,
  resolveLedgerEntryPremium,
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
  /** False when the tape fetch this scan depends on failed and silently degraded to an
   *  empty read — distinguishes "genuinely quiet tape" from "the scan couldn't see the
   *  tape at all" so the board's freshness badge can tell members apart instead of
   *  always reading "Live". Never gates scoring/output, purely a provenance signal. */
  upstream_ok: boolean;
  /** Every candidate ticker this cycle that failed at least one of deriveZeroDteSetups'
   *  4 gates (task #147) — the near-miss half of this scan's output. The board route
   *  ignores this field entirely (member polls never persist); only warmZeroDteBoard
   *  forwards it to persistZeroDteRejections, on the same cron cadence committed
   *  setups already persist on. */
  rejections: ZeroDteGateRejection[];
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
  let upstreamOk = true;
  const [flows, nhEdition] = await Promise.all([
    // max_dte: 1 is LOAD-BEARING — it scopes the premium ranking to 0-1DTE prints in
    // SQL. Without it the top-400 spans ALL expiries and heavy-day whale prints crowd
    // every 0DTE print out of the scan's input (live-reproduced: $3.1M AAPL stack → 0 setups).
    fetchRecentFlows({ since_hours: 7, min_premium: 150_000, order: "premium", limit: 400, max_dte: 1 }).catch(
      () => {
        upstreamOk = false;
        return [];
      }
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

  // Always collected (cheap — a handful of array pushes per candidate ticker);
  // whether it's ever WRITTEN anywhere is a separate decision made by the caller
  // (only warmZeroDteBoard forwards it to persistZeroDteRejections below).
  const rejections: ZeroDteGateRejection[] = [];
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
      open_interest: f.open_interest,
      alerted_at: f.alerted_at,
    })),
    { maxSetups: 10, excludeTickers: excludes, nowMs: Date.now(), todayYmd: today, rejections }
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
  const tape = await attachIntradayEdge(setups);
  // Hard-gate verdicts LAST — G-3 judges the final post-edge-layer score, and G-1
  // reuses the same SPY read the edge layer just fetched (one bias per scan cycle,
  // scoring and gating can never disagree about what the tape said).
  await attachGateVerdicts(setups, tape.bias, tape.biasAsOfMs);

  return { setups, nighthawk_covered: nighthawkCovered, upstream_ok: upstreamOk, rejections };
}

/** Cached (3-min) intraday read from a name's own minute bars. */
async function intradayReadFor(ticker: string, today: string): Promise<IntradayRead | null> {
  return within(
    withServerCache<IntradayRead>(`zerodte:intraday:${ticker}:${today}`, 3 * 60 * 1000, async () => {
      // Index roots (SPXW/SPX/NDX…) only price under Polygon's I: namespace —
      // unmapped they return zero bars and the read silently degrades to nulls.
      const bars = await fetchAggBars(polygonSpotTicker(ticker), 1, "minute", today, today, "1000");
      return computeIntradayRead(
        bars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c, v: b.v }))
      );
    }),
    2_500
  );
}

/** The "is it working RIGHT NOW" layer: each top play's own minute-bar read
 *  (session VWAP / opening range / 5m trend), SPY as the market tape, and the
 *  time-of-day edge window — all folded into the score, with hard intraday
 *  conflicts flagged for the A-tier gate. Best-effort: missing bars = no adjust.
 *  Returns the SPY bias (+ its freshness) so the hard-gate layer judges the SAME
 *  tape read the scores were adjusted with. */
async function attachIntradayEdge(
  setups: EnrichedZeroDteSetup[]
): Promise<{ bias: MarketBias | null; biasAsOfMs: number | null }> {
  if (setups.length === 0) return { bias: null, biasAsOfMs: null };
  const today = todayEt();
  const { hour, minute } = etNowParts();
  const nowEt = hour * 60 + minute;
  const tod = timeOfDayFactor(nowEt);

  const top = setups.slice(0, ENRICH_TOP_N);
  const [spyRead, ...reads] = await Promise.all([
    intradayReadFor("SPY", today),
    ...top.map((s) => intradayReadFor(s.ticker, today)),
  ]);
  const bias = marketBias(spyRead ?? null);

  top.forEach((s, i) => {
    const read = reads[i] ?? null;
    const adj = intradayScoreAdjust(s.direction, read);
    const align = marketAlignAdjust(s.direction, bias);
    s.intraday = read;
    s.intraday_conflict = adj.conflict;
    s.market_aligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
    s.tod_label = tod.label;
    s.score = Math.max(0, Math.min(100, s.score + adj.delta + align + tod.delta));
  });
  return { bias, biasAsOfMs: spyRead?.last_bar_ms ?? null };
}

/** Hard-gate verdicts (G-1.. — ./gates.ts) for every FRESH find this cycle.
 *  Already-committed ledger tickers are refreshes and are never re-gated (a printed
 *  play is managed to its exit, not retro-blocked). If the committed set can't be
 *  read, gates stay null and persistZeroDteScan fails closed on every fresh commit —
 *  the same "unreadable input is a block, not a pass" rule the evidence gates follow. */
async function attachGateVerdicts(
  setups: EnrichedZeroDteSetup[],
  bias: MarketBias | null,
  biasAsOfMs: number | null
): Promise<void> {
  if (setups.length === 0) return;
  const { hour, minute } = etNowParts();
  const nowEtMinutes = hour * 60 + minute;
  const nowMs = Date.now();
  const committed = dbConfigured()
    ? await fetchZeroDteSetupLog(todayEt())
        .then((rows) => new Set(rows.map((r) => r.ticker.toUpperCase())))
        .catch(() => null)
    : new Set<string>();
  if (committed == null) return; // gates stay null → fresh commits fail closed downstream

  for (const s of setups) {
    if (committed.has(s.ticker.toUpperCase())) continue;
    s.gate = evaluateZeroDteGates({
      ticker: s.ticker,
      direction: s.direction,
      score: s.score,
      nowEtMinutes,
      nowMs,
      bias,
      biasAsOfMs,
    });
  }
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
 *
 *  Two lanes, split against the committed set:
 *  - REFRESH (ticker already in today's ledger): always upserted — a committed play
 *    is managed to its exit, never retro-blocked, and the upsert's COALESCE pins
 *    keep its plan/entry immutable anyway.
 *  - FRESH commit: must clear the hard gate stack (setup.gate, ./gates.ts). Blocked
 *    finds are persisted to zerodte_scan_rejections (machine code + human sentence)
 *    instead — visible SKIP, never a silent drop. A missing verdict (gate context
 *    unreadable) fails closed, and an unreadable committed set fails the whole
 *    persist closed (can't tell fresh from committed → nothing new may print).
 *
 *  After the 15:00 ET cutoff only EXISTING plays are refreshed — a fresh flag in
 *  power hour never opens a new 0DTE play (this predates and stays alongside the
 *  gate stack's own opening-window rule). */
export async function persistZeroDteScan(setups: EnrichedZeroDteSetup[]): Promise<number> {
  if (!dbConfigured() || setups.length === 0) return 0;
  const today = todayEt();
  const { hour, minute } = etNowParts();
  const pastCutoff = hour * 60 + minute >= NEW_PLAY_CUTOFF_ET_MINUTES;

  const existingRows = await fetchZeroDteSetupLog(today).catch(() => null);
  if (existingRows == null) return 0; // fail closed: fresh vs committed is unknowable
  const existing = new Set(existingRows.map((r) => r.ticker.toUpperCase()));

  const refresh = setups.filter((s) => existing.has(s.ticker.toUpperCase()));
  const freshCandidates = pastCutoff ? [] : setups.filter((s) => !existing.has(s.ticker.toUpperCase()));

  const committedFresh: EnrichedZeroDteSetup[] = [];
  const gateRejections: import("./board").ZeroDteGateRejection[] = [];
  for (const s of freshCandidates) {
    if (s.gate?.verdict === "COMMIT") committedFresh.push(s);
    else gateRejections.push(gateRejectionFor(s, s.gate));
  }
  if (gateRejections.length > 0) {
    // Fail-visible half of the block: best-effort durable record (same throttled
    // write path the evidence-gate near-misses use), logged loudly on failure but
    // never allowed to break the scan itself.
    void persistZeroDteRejections(gateRejections).catch((err) => {
      console.warn("[zerodte-gates] failed to persist gate rejections:", err);
    });
  }

  const eligible = [...committedFresh, ...refresh];
  if (eligible.length === 0) return 0;
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
    // Premium reference the plan grades against — MUST match entry_max (the
    // member's actual "enter at or below" instruction), not the raw live mark;
    // see resolveLedgerEntryPremium's doc comment (plan.ts) for why.
    entry_premium: resolveLedgerEntryPremium(s.plan?.entry_max, s.top_strike_avg_fill),
    flow_avg_fill: s.top_strike_avg_fill,
    plan_json: s.plan ? ({ ...s.plan } as unknown as Record<string, unknown>) : null,
    gate_calibration_json: null,
    flags_json: {
      ...(s.earnings ? { earnings: s.earnings } : {}),
      ...(s.news_hot ? { news_hot: s.news_hot.title } : {}),
      ...(s.halted ? { halted: true } : {}),
      ...(s.fib_note ? { fib: s.fib_note.label } : {}),
      ...(s.direction_confirmed != null ? { dossier_agrees: s.direction_confirmed } : {}),
    },
  }));
  const freshlyFlagged = await upsertZeroDteSetupLog(rows);
  if (freshlyFlagged.size > 0) {
    recordZeroDteAuditTrail(
      eligible.filter((s) => freshlyFlagged.has(s.ticker.toUpperCase())),
      today
    );
  }
  return rows.length;
}

/** Stage 4 audit trail: fire-and-forget, one row per setup, ONLY for setups that
 *  were a fresh insert this cycle (see upsertZeroDteSetupLog) — a later refresh of
 *  the same session/ticker never writes a second audit row. Failures are logged,
 *  never thrown — the audit trail must not be able to break the scanner. */
function recordZeroDteAuditTrail(freshSetups: EnrichedZeroDteSetup[], sessionDate: string): void {
  for (const setup of freshSetups) {
    const row = buildZeroDteAuditRow(setup, sessionDate);
    void insertAlertAuditLog(row).catch((err) => {
      console.warn(`[zerodte-audit] failed to write alert_audit_log for ${setup.ticker}:`, err);
    });
  }
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
      // polygonSpotTicker: an index-root row (SPXW/SPX/NDX…) must fetch its close
      // from the I: index symbol — the raw root "succeeds" with 0 results, which
      // would stamp the row graded with a permanent null direction grade (the
      // catch-and-retry path only covers thrown fetches, not empty ones).
      const bars = await fetchAggBars(polygonSpotTicker(row.ticker), 1, "day", row.session_date, row.session_date);
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
  const { setups, rejections } = await scanZeroDteBoard();
  const logged = await persistZeroDteScan(setups).catch(() => 0);
  // Near-miss log (task #147) — same cron cadence persistZeroDteScan uses above,
  // never the member-poll board route. Best-effort: a failure here must never
  // affect the real board setups above.
  void persistZeroDteRejections(rejections).catch(() => 0);
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
  const live = rows.filter((r) => r.status !== "CLOSED");
  if (live.length === 0) return rows;
  const occs = live
    .map((r) => (typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null))
    .filter((o): o is string => Boolean(o));
  const snaps = occs.length
    ? await within(
        fetchOptionsUnifiedSnapshot(occs).catch(
          () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
        ),
        2_500
      )
    : new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>();
  if (!snaps) return rows;
  const { hour, minute } = etNowParts();
  const nowEtMinutes = hour * 60 + minute;

  const updated = await Promise.all(
    rows.map(async (r) => {
      // CLOSED is terminal; every other row gets a state pass — rows with no plan/
      // entry still time-stop at 15:30 (data quality never exempts the clock).
      if (r.status === "CLOSED") return r;
      const occ = typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null;
      const mark = occ ? (snaps.get(occ)?.mark ?? null) : null;
      const entryRef = r.entry_premium ?? 0;
      const peak = Math.max(r.peak_premium ?? entryRef, mark ?? 0);
      const trough = Math.min(r.trough_premium ?? (r.entry_premium ?? Number.MAX_VALUE), mark ?? Number.MAX_VALUE);
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

// ── BlackOut Intelligence — shared desk awareness ─────────────────────────────────
// The rest of the ecosystem (Largo's ambient live feed, its get_zerodte_plays tool,
// any future surface) consumes the SAME deterministic intelligence the board shows
// members — one brain, many mouths. No LLM in this path.

/** Compact ledger snapshot for ambient awareness. Used in Largo's live feed on EVERY
 *  question (captureLargoLiveFeed in largo-live-feed.ts), unconditionally — unlike
 *  get_zerodte_plays, which Largo only calls when it decides the question needs it.
 *  That makes this the code path a member's answer is actually built from most of
 *  the time for "how's my NVDA play doing" style questions.
 *
 *  P1 FIX (found during the 0DTE Command entry-gate audit, see FINDINGS.md): this
 *  used to read readZeroDteLedger() RAW with no live-quote sync, trusting the
 *  status/last_mark exactly as the ~2-min grid-warm cron last wrote them to
 *  Postgres. That is precisely the "0DTE board / Largo / BIE used parallel scan
 *  paths" bug class already found+fixed for the get_zerodte_plays TOOL path and
 *  BIE composers (both now funnel through zeroDtePlaysForLargo() /
 *  getZeroDteBoardPayload() in zerodte-service.ts, which DOES call
 *  syncLedgerLiveState() before mapping ledger rows) — that fix never touched this
 *  function, so the ambient feed could tell Largo a play was still "OPEN" at a
 *  stale mark for up to ~2 minutes (or longer if a cron tick was missed) after it
 *  had actually stopped out or doubled, and Largo's system prompt treats this block
 *  as "authoritative source for this turn" without necessarily calling the fresher
 *  tool. Now calls the SAME syncLedgerLiveState() the canonical board payload uses,
 *  so this reflects the live quote, not the last cron write. Deliberately still a
 *  direct ledger read (not routed through getZeroDteBoardPayload()) rather than the
 *  heavier full-board rebuild: this ambient block only ever surfaces already-
 *  flagged ledger rows (never `setups`/`fresh_finds`), and importing
 *  zerodte-service.ts here would be circular (it imports FROM this module). */
export async function zeroDtePlaysFeed(): Promise<Record<string, unknown>> {
  const raw = await readZeroDteLedger();
  if (raw.length === 0) return { available: false, note: "no 0DTE plays flagged this session" };
  const rows = await syncLedgerLiveState(raw).catch(() => raw);
  return {
    available: true,
    session_date: todayEt(),
    plays: rows.map((r) => ({
      ticker: r.ticker,
      contract: `${r.top_strike ?? "?"}${r.direction === "long" ? "c" : "p"}`,
      status: r.status ?? "HOLD",
      entry_premium: r.entry_premium,
      last_mark: r.last_mark,
      peak_score: r.score_max,
      spike: r.spike,
      first_flagged_et: r.first_flagged_at,
      result: r.plan_outcome
        ? `${r.plan_outcome}${r.plan_pnl_pct != null ? ` ${r.plan_pnl_pct > 0 ? "+" : ""}${r.plan_pnl_pct}%` : ""}`
        : null,
    })),
  };
}

/** @deprecated Import from `@/lib/platform/zerodte-service` — single board cache lane. */
export { zeroDtePlaysForLargo } from "@/lib/platform/zerodte-service";
