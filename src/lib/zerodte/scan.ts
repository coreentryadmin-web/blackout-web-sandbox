// 0DTE Command scanner — the ALWAYS-ON half of the board. The same pipeline runs
// two ways: the grid-warm cron calls warmZeroDteBoard() every ~2 min through RTH
// (so the system hunts all session even when nobody is looking), and the board
// route calls scanZeroDteBoard() on member polls (collapsed to one build per 5s).
// Every qualifying find is upserted into the zerodte_setup_log ledger and graded
// against the session close afterwards — the board's discovery record is measured,
// not asserted.
//
// Mandate (product rule): this surface finds NEW plays. SPX/index products belong
// to the SPX engines, and any ticker in the latest Night Hawk edition is excluded —
// a name members already have is a repeat, not a find.

import {
  dbConfigured,
  fetchLatestNighthawkEdition,
  fetchRecentFlows,
  fetchUngradedZeroDteRows,
  fetchZeroDteSetupLog,
  gradeZeroDteSetupRow,
  upsertZeroDteSetupLog,
  type ZeroDteSetupLogRow,
  type ZeroDteSetupLogUpsert,
} from "@/lib/db";
import { INDEX_SET, LEVERAGED_ETP_SET } from "@/lib/nighthawk/constants";
import { createDossierBuildCache, fetchTickerDossier } from "@/lib/nighthawk/dossier";
import { todayEt } from "@/lib/nighthawk/session";
import { fetchAggBars } from "@/lib/providers/polygon-largo";
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

/** SPX/SPY/index products are covered by the SPX engines; leveraged wrappers are
 *  not single-name plays. Night Hawk's tickers are added per-scan. */
const STATIC_EXCLUDES = new Set<string>([...INDEX_SET, ...LEVERAGED_ETP_SET, "SPX", "SPY", "QQQ", "IWM"]);

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
    fetchRecentFlows({ since_hours: 7, min_premium: 150_000, order: "premium", limit: 400 }).catch(
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

  return { setups, nighthawk_covered: nighthawkCovered };
}

/** Persist a scan's finds into the session ledger (no-op without a database). */
export async function persistZeroDteScan(setups: EnrichedZeroDteSetup[]): Promise<number> {
  if (!dbConfigured() || setups.length === 0) return 0;
  const today = todayEt();
  const rows: ZeroDteSetupLogUpsert[] = setups.map((s) => ({
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
  void gradeZeroDteLedger().catch(() => {});
  return { found: setups.length, logged };
}

/** Today's ledger for the board's "flagged today" lane (empty without a database). */
export async function readZeroDteLedger(): Promise<ZeroDteSetupLogRow[]> {
  if (!dbConfigured()) return [];
  return fetchZeroDteSetupLog(todayEt()).catch(() => []);
}
