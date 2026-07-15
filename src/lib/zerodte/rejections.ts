// 0DTE Command near-miss / gate-rejection log (task #147) — the multi-ticker
// analogue of spx_engine_snapshots (task #108, src/lib/providers/spx-signal-log.ts's
// maybeLogSpxEngineSnapshot/fetchRecentSpxSnapshots). deriveZeroDteSetups
// (./board.ts) computes real gate metrics (gross premium, at-the-ask aggression
// share, side dominance, OTM%) for every candidate ticker it aggregates from the
// HELIX tape and checks them against 4 thresholds (SETUP_MIN_GROSS/
// SETUP_MIN_AGGR_SHARE/SETUP_MIN_DOMINANCE/SETUP_MAX_ITM_PCT) — but a ticker that
// fails ANY one of them is silently `continue`d past with nothing persisted.
// Committed setups already have a durable record via zerodte_setup_log/
// persistZeroDteScan (./scan.ts) — this module is deliberately the REJECTED half
// only, so "why didn't ticker X ever hit the Grid board" becomes answerable.
//
// THROTTLING: SPX Slayer is a single instrument, so spx_engine_snapshots' throttle
// is one platform_meta cursor STRING (engineSnapshotStateKey). 0DTE Command watches
// many simultaneous candidate tickers per scan, so a single scalar cursor can't
// represent "have I already logged THIS ticker's current rejection state" — this
// keeps ONE platform_meta row (ZERODTE_REJECTION_CURSOR_KEY) whose value is a JSON
// map of `{ [ticker]: { date, key } }`. `key` is the same kind of state-transition
// signature engineSnapshotStateKey() uses (gate_failed + direction; deliberately
// EXCLUDES gross_premium/aggression/side_dominance/otm_pct, which jitter tick-to-
// tick on an otherwise-unchanged rejection and would defeat the throttle if
// included — same reasoning signalKey()/engineSnapshotStateKey() give for excluding
// score/thesis/headline). The map is pruned to TODAY's date on every load (a prior
// session's entries are dropped, not carried forward), so the cursor blob stays
// bounded and a new day's first rejection for a previously-seen ticker always logs
// rather than being silently suppressed by yesterday's leftover state.
//
// This module deliberately lives OUTSIDE scan.ts: scan.ts's import graph pulls in
// the full Night Hawk dossier builder, Polygon bar/quote providers, and the options
// WS socket (heavy, provider-import-full) purely to run the scan pipeline. The
// throttled write/read path here only ever needs @/lib/db + the shared ET-date
// helper, kept import-light the same way spx-signal-log.ts is for SPX — so a test
// of this file's throttle logic doesn't need to mock any of scan.ts's provider
// imports, only @/lib/db.
import { dbConfigured, getMeta, setMeta, insertZeroDteScanRejection, fetchZeroDteScanRejections } from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { ZeroDteGateRejection } from "./board";

const ZERODTE_REJECTION_CURSOR_KEY = "zerodte_scan_rejection_cursor";

type CursorEntry = { date: string; key: string };

/** State-transition key for the per-ticker throttle — gate_failed + direction only
 *  (see module doc above for why the jittery numeric fields are excluded). */
function rejectionStateKey(r: Pick<ZeroDteGateRejection, "gate_failed" | "direction">): string {
  return JSON.stringify({ gate: r.gate_failed, direction: r.direction });
}

async function loadRejectionCursor(today: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const raw = await getMeta(ZERODTE_REJECTION_CURSOR_KEY);
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, CursorEntry>;
    for (const [ticker, entry] of Object.entries(parsed)) {
      // Drop anything not from today — a new session's first rejection for a
      // ticker that also rejected yesterday must always log, never be silently
      // suppressed by a stale cursor entry from a prior day.
      if (entry && entry.date === today && typeof entry.key === "string") {
        map.set(ticker, entry.key);
      }
    }
  } catch {
    // Corrupt/legacy value — treat as empty; the next save overwrites it cleanly.
  }
  return map;
}

async function saveRejectionCursor(today: string, map: Map<string, string>): Promise<void> {
  const obj: Record<string, CursorEntry> = {};
  for (const [ticker, key] of map.entries()) obj[ticker] = { date: today, key };
  await setMeta(ZERODTE_REJECTION_CURSOR_KEY, JSON.stringify(obj));
}

/**
 * Persist this scan cycle's near-misses — throttled to one row per ticker per
 * DISTINCT (gate_failed, direction) state, not one row per scan cycle. Called from
 * warmZeroDteBoard (./scan.ts) on the ~2-min grid-warm cron — the SAME cadence
 * persistZeroDteScan already uses for committed setups — never from the member-poll
 * board route, so this never runs on the hot request path. Even at that cadence,
 * unthrottled writes would flood Postgres with a near-duplicate row per candidate
 * on every tick while a name idles in an unchanged rejected state; hence the cursor
 * above. Best-effort: never throws into the caller (mirrors persistZeroDteScan's
 * own `.catch(() => 0)` contract at its one call site).
 */
export async function persistZeroDteRejections(rejections: ZeroDteGateRejection[]): Promise<number> {
  if (!dbConfigured() || rejections.length === 0) return 0;
  const today = todayEtYmd();
  const cursor = await loadRejectionCursor(today);

  const toWrite: ZeroDteGateRejection[] = [];
  for (const r of rejections) {
    const key = rejectionStateKey(r);
    if (cursor.get(r.ticker) === key) continue;
    cursor.set(r.ticker, key);
    toWrite.push(r);
  }
  if (toWrite.length === 0) return 0;

  // Sequential, not batched — a scan cycle's rejection count is bounded by the
  // candidate universe (single digits to low tens), so a multi-row round trip
  // isn't worth the dynamic-SQL complexity (mirrors insertSpxEngineSnapshot's own
  // one-row-at-a-time idiom; SPX only ever has one row per tick to begin with).
  for (const r of toWrite) {
    await insertZeroDteScanRejection({
      session_date: today,
      ticker: r.ticker,
      gate_failed: r.gate_failed,
      threshold: r.threshold,
      gross_premium: r.gross_premium,
      aggression: r.aggression,
      side_dominance: r.side_dominance,
      otm_pct: r.otm_pct,
      direction: r.direction,
      prints: r.prints,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      reason: r.reason ?? null,
    });
  }
  await saveRejectionCursor(today, cursor);
  return toWrite.length;
}

export type ZeroDteRejectionRow = {
  id: number;
  observed_at: string;
  session_date: string;
  ticker: string;
  gate_failed: string;
  threshold: number | null;
  gross_premium: number;
  aggression: number | null;
  side_dominance: number | null;
  otm_pct: number | null;
  direction: string | null;
  prints: number | null;
  first_seen: string | null;
  last_seen: string | null;
  reason: string | null;
};

/** Read path shared by the Largo tool below (and any future admin surface):
 *  "why didn't ticker X make the board" / "what has the scanner been rejecting
 *  today." Empty array (not a throw) when the DB isn't configured. */
export async function fetchZeroDteRejections(opts?: {
  ticker?: string;
  limit?: number;
}): Promise<ZeroDteRejectionRow[]> {
  if (!dbConfigured()) return [];
  return fetchZeroDteScanRejections(opts);
}

/** Largo tool payload (get_zerodte_rejections, run-tool.ts) — same `available`
 *  envelope idiom zeroDtePlaysFeed() uses in ./scan.ts for the committed-plays
 *  side of this same scanner. */
export async function zeroDteRejectionsForLargo(ticker?: string, limit = 20): Promise<Record<string, unknown>> {
  const rows = await fetchZeroDteRejections({ ticker, limit });
  if (rows.length === 0) {
    return {
      available: false,
      note: ticker
        ? `no gate-rejection history found for ${ticker.toUpperCase()} today`
        : "no 0DTE Command gate rejections logged yet this session",
    };
  }
  return {
    available: true,
    source: "0DTE Command scanner near-miss log (zerodte_scan_rejections) — NOT SPX Slayer",
    ticker: ticker ? ticker.toUpperCase() : null,
    rejections: rows.map((r) => ({
      ticker: r.ticker,
      observed_at: r.observed_at,
      gate_failed: r.gate_failed,
      reason: r.reason,
      threshold: r.threshold,
      gross_premium: r.gross_premium,
      aggression: r.aggression,
      side_dominance: r.side_dominance,
      otm_pct: r.otm_pct,
      direction: r.direction,
      prints: r.prints,
    })),
  };
}
