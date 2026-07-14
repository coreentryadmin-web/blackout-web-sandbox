// PR-N1 historical repair (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §0.1/H-1/H-2).
//
// Before PR-N1, ensureSchema() re-issued the play-outcome CHECK constraint a second
// time WITHOUT 'unfilled' (the stale block that lived after the admin_audit_log DDL in
// db.ts), so every UPDATE grading a play `unfilled` threw a check-constraint violation
// and the row stayed `pending` forever. Compounding it, the outcomes cron only looks
// back 7 days (resolvePendingNighthawkOutcomes' default) while `pending_count` is
// unwindowed — so once a failed-write row aged past the window it became a permanent
// orphan the cron would never revisit (12 such rows as of 2026-07-14: AAPL/CSX/MAGS
// @07-06, AMZN/BAC/TSLA@07-07, AMD/DELL/WFC@07-08, PG@07-09, META/PANW@07-10).
//
// This module is the bounded, idempotent, dry-runnable repair: select rows still
// `pending` whose edition date is OLDER than the resolver's lookback (rows inside the
// window belong to the cron and are deliberately excluded), and re-run the SAME
// resolution path the cron uses (one Polygon daily bar → resolveOutcome → persist).
// It deliberately does NOT widen the cron's 7-day lookback — that stays as-is (the
// unwindowed-pending vs windowed-resolver mismatch is the separate N2 concern); this
// repair is admin-invoked, so historical fixes stay an explicit, audited action
// instead of a silent every-boot sweep.
//
// Idempotency comes from the same two facts the cron relies on: the stuck-row query
// only returns `outcome = 'pending'` rows, and updateNighthawkPlayOutcome's UPDATE is
// guarded `WHERE outcome = 'pending'` — a row this repair grades can never match
// again. A row whose session bar is genuinely unavailable stays pending and re-matches
// a future run, which is honest (it IS still stuck) and harmless (bounded + admin-only).
//
// Same split as the 0DTE P-6 backfill (zerodte/regrade.ts + admin/zerodte/
// regrade-index-roots): pure selector here as the executable spec, DB/Polygon I/O
// injected so the unit tests are hermetic, thin admin route on top.

import {
  fetchPendingNighthawkOutcomes,
  updateNighthawkPlayOutcome,
  type NighthawkPlayOutcomeRow,
} from "@/lib/db";
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { outcomeSessionDate, resolveOutcome } from "./play-outcomes";
import { todayEt } from "./session";

/** Mirrors resolvePendingNighthawkOutcomes' default lookback (play-outcomes.ts). If
 *  that default ever changes, this must follow — the selector below defines "stuck"
 *  as "pending AND older than what the cron will ever look at again". */
export const RESOLVER_LOOKBACK_DAYS = 7;

/** How far back the repair searches for stuck rows. The product's entire history is
 *  weeks old, so 90 days covers everything while still bounding the query. */
export const DEFAULT_SEARCH_WINDOW_DAYS = 90;
export const MAX_SEARCH_WINDOW_DAYS = 365;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Pure YYYY-MM-DD arithmetic (UTC — inputs are calendar dates, not instants). */
export function isoDaysBefore(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Math.max(0, Math.trunc(days)));
  return d.toISOString().slice(0, 10);
}

/**
 * The exact "permanent orphan" signature (H-1 aftermath + H-2 window mismatch):
 *  - still `pending` — a graded row needs no repair,
 *  - edition strictly OLDER than the resolver's lookback cutoff — a pending row
 *    still inside the window is the cron's job (it will grade it on its next tick
 *    now that the constraint accepts 'unfilled'); repairing it here too would just
 *    race the cron for zero benefit.
 */
export function isStuckNighthawkOutcome(
  row: Pick<NighthawkPlayOutcomeRow, "outcome" | "edition_for">,
  today: string,
  resolverLookbackDays: number = RESOLVER_LOOKBACK_DAYS
): boolean {
  if (row.outcome !== "pending") return false;
  return row.edition_for < isoDaysBefore(today, resolverLookbackDays);
}

export type DailyBar = { o: number; h: number; l: number; c: number };

/** I/O seams, injectable so the unit tests run without Postgres or Polygon. */
export type RegradeStuckDeps = {
  /** Pending rows within a lookback window — prod: fetchPendingNighthawkOutcomes. */
  fetchPending: (lookbackDays: number) => Promise<NighthawkPlayOutcomeRow[]>;
  /** The play's single grading session bar — prod: fetchStockDailyBars(t, d, d). */
  fetchDailyBar: (ticker: string, sessionDate: string) => Promise<DailyBar | null>;
  /** Persist a grade — prod: updateNighthawkPlayOutcome (WHERE outcome='pending'). */
  persist: (id: number, patch: Parameters<typeof updateNighthawkPlayOutcome>[1]) => Promise<void>;
  today: () => string;
};

export type RegradeStuckOptions = {
  dryRun?: boolean;
  limit?: number;
  searchWindowDays?: number;
  resolverLookbackDays?: number;
};

export type RegradedRowSummary = {
  id: number;
  ticker: string;
  edition_for: string;
  outcome: NighthawkPlayOutcomeRow["outcome"];
  hit_target: boolean;
  hit_stop: boolean;
};

export type RegradeStuckResult = {
  dry_run: boolean;
  /** Stuck rows the selector matched (before the limit bound). */
  matched: number;
  /** Rows actually persisted this run (always 0 on dry-run). */
  regraded: number;
  /** Stuck rows whose session bar is unavailable — left pending, re-match next run. */
  skipped_no_bar: number;
  errors: string[];
  /** What each processed row graded (or WOULD grade, on dry-run) to. */
  rows: RegradedRowSummary[];
};

function defaultDeps(): RegradeStuckDeps {
  return {
    fetchPending: (lookbackDays) => fetchPendingNighthawkOutcomes(lookbackDays),
    fetchDailyBar: async (ticker, sessionDate) => {
      const bars = await fetchStockDailyBars(ticker, sessionDate, sessionDate, "1");
      return bars[0] ?? null;
    },
    persist: (id, patch) => updateNighthawkPlayOutcome(id, patch),
    today: todayEt,
  };
}

/**
 * Re-run outcome resolution for rows stuck `pending` beyond the resolver's lookback.
 * Bounded (limit, hard-capped), idempotent (see module doc), dry-runnable (resolves
 * but persists nothing). Per-row failures land in `errors` — callers (the admin
 * route) surface them; they are never swallowed into an `ok` result.
 */
export async function regradeStuckNighthawkOutcomes(
  opts: RegradeStuckOptions = {},
  deps: Partial<RegradeStuckDeps> = {}
): Promise<RegradeStuckResult> {
  const dryRun = opts.dryRun === true;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
  const searchWindowDays = Math.min(
    MAX_SEARCH_WINDOW_DAYS,
    Math.max(1, Math.trunc(opts.searchWindowDays ?? DEFAULT_SEARCH_WINDOW_DAYS))
  );
  const resolverLookbackDays = Math.max(
    0,
    Math.trunc(opts.resolverLookbackDays ?? RESOLVER_LOOKBACK_DAYS)
  );

  const result: RegradeStuckResult = {
    dry_run: dryRun,
    matched: 0,
    regraded: 0,
    skipped_no_bar: 0,
    errors: [],
    rows: [],
  };

  // Same guard as the cron path: without a bar source nothing can be graded. Only
  // enforced when the caller didn't inject its own fetcher (tests / future sources).
  if (!deps.fetchDailyBar && !polygonConfigured()) {
    result.errors.push("Polygon not configured");
    return result;
  }

  const io: RegradeStuckDeps = { ...defaultDeps(), ...deps };
  const today = io.today();

  const pending = await io.fetchPending(searchWindowDays);
  const stuck = pending.filter((row) => isStuckNighthawkOutcome(row, today, resolverLookbackDays));
  result.matched = stuck.length;

  for (const row of stuck.slice(0, limit)) {
    try {
      const sessionDate = outcomeSessionDate(row);
      const bar = await io.fetchDailyBar(row.ticker, sessionDate);
      if (!bar) {
        result.skipped_no_bar += 1;
        continue;
      }

      const verdict = resolveOutcome({
        ...row,
        next_day_open: bar.o,
        next_day_close: bar.c,
        session_high: bar.h,
        session_low: bar.l,
      });

      if (!dryRun) {
        await io.persist(row.id, {
          next_day_open: bar.o,
          next_day_close: bar.c,
          session_high: bar.h,
          session_low: bar.l,
          hit_target: verdict.hit_target,
          hit_stop: verdict.hit_stop,
          outcome: verdict.outcome,
        });
        result.regraded += 1;
      }

      result.rows.push({
        id: row.id,
        ticker: row.ticker,
        edition_for: row.edition_for,
        outcome: verdict.outcome,
        hit_target: verdict.hit_target,
        hit_stop: verdict.hit_stop,
      });
    } catch (err) {
      result.errors.push(
        `${row.ticker}@${row.edition_for}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
