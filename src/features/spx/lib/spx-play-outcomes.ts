import { dbConfigured, fetchClosedPlayOutcomes } from "@/lib/db";
import { nextMemoryPlayId } from "@/features/spx/lib/spx-play-memory-id";
import type { ClaudePlayVerdict } from "@/features/spx/lib/spx-play-claude";
import type { PlayConfirmationResult } from "@/features/spx/lib/spx-play-confirmations";
import type { MtfHybrid } from "@/features/spx/lib/spx-play-mtf";
import type { OptionTicket } from "@/features/spx/lib/spx-play-options";
import type { SpxPlayDirection, SpxSignalFactor } from "@/features/spx/lib/spx-signals";

export type PlayEntryPath = "cold_buy" | "watch_promote";

export type PlayEntrySnapshot = {
  open_play_id: number;
  session_date: string;
  direction: SpxPlayDirection;
  entry_path: PlayEntryPath;
  grade: string;
  score: number;
  confidence: number;
  entry_price: number;
  stop: number | null;
  target: number | null;
  headline: string;
  factors: SpxSignalFactor[];
  confirmations: PlayConfirmationResult | null;
  mtf: MtfHybrid | null;
  claude: ClaudePlayVerdict | null;
  option_ticket: OptionTicket | null;
  opened_at: string;
};

export type PlayExitAction = "STOP" | "TARGET" | "THESIS" | "SESSION" | "THETA" | "TRAIL" | "UNKNOWN";

export type PlayCloseSnapshot = {
  exit_price: number;
  exit_action: PlayExitAction;
  mfe_pts: number;
  mae_pts: number;
  trim_done: boolean;
  was_loss: boolean;
  pnl_pts: number;
};

export type PlayOutcomeRow = {
  id: number;
  open_play_id: number;
  session_date: string;
  direction: SpxPlayDirection;
  entry_path: PlayEntryPath;
  grade: string;
  score: number;
  confidence: number;
  entry_price: number;
  exit_price: number | null;
  stop: number | null;
  target: number | null;
  mfe_pts: number;
  mae_pts: number;
  trim_done: boolean;
  pnl_pts: number | null;
  outcome: "open" | "win" | "loss" | "breakeven" | "superseded";
  exit_action: PlayExitAction | null;
  headline: string;
  opened_at: string;
  closed_at: string | null;
};

export type PlayOutcomeStats = {
  total_closed: number;
  oldest_closed_at: string | null;
  days_of_data: number;
  overall: { wins: number; losses: number; breakeven: number; win_rate: number };
  cold_buy: { count: number; wins: number; losses: number; win_rate: number; avg_mfe: number; avg_mae: number };
  watch_promote: { count: number; wins: number; losses: number; win_rate: number; avg_mfe: number; avg_mae: number };
};

const memoryOutcomes: PlayOutcomeRow[] = [];

// ---------------------------------------------------------------------------
// Write-failure observability. Open-path entry writes are transactional in insertOpenSpxPlay;
// this counter mainly tracks close-path failures and legacy entry failures.
// ---------------------------------------------------------------------------
const PLAY_WRITE_FAILURE_META_KEY = "spx_play_outcome_write_failures";

export type PlayWriteFailureState = {
  count: number;
  last_at: string | null;
  last_phase: "entry" | "close" | null;
  last_open_play_id: number | null;
  last_message: string | null;
};

let memoryWriteFailures: PlayWriteFailureState = {
  count: 0,
  last_at: null,
  last_phase: null,
  last_open_play_id: null,
  last_message: null,
};

/**
 * Record a play-outcome write failure loudly + durably. Never throws (best-effort
 * persistence so a meta-write blip can't cascade into the engine). Always logs a
 * structured console.error so Railway/Vercel logs surface the failure immediately.
 */
export async function recordPlayWriteFailure(
  phase: "entry" | "close",
  openPlayId: number | null,
  err: unknown
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  // LOUD: this is the failure that silently starves the track record.
  console.error(
    `[spx-play-outcomes] WRITE FAILURE phase=${phase} open_play_id=${openPlayId ?? "?"}: ${message}`
  );

  const next: PlayWriteFailureState = {
    count: memoryWriteFailures.count + 1,
    last_at: new Date().toISOString(),
    last_phase: phase,
    last_open_play_id: openPlayId,
    last_message: message.slice(0, 500),
  };
  memoryWriteFailures = next;

  if (!dbConfigured()) return;
  try {
    // Relative import (not the "@/" alias) — see readPlayWriteFailures()/fetchPlayOutcomeStats()
    // below for why.
    const { getMeta, setMeta } = await import("@/lib/db");
    // Read-modify-write the durable cross-replica count so the counter survives
    // restarts and is visible on the API replica (not just the cron replica).
    let persisted: PlayWriteFailureState = next;
    const raw = await getMeta(PLAY_WRITE_FAILURE_META_KEY);
    if (raw) {
      try {
        const prev = JSON.parse(raw) as PlayWriteFailureState;
        persisted = { ...next, count: (prev.count ?? 0) + 1 };
      } catch {
        /* corrupt meta — overwrite with the fresh single-count state */
      }
    }
    await setMeta(PLAY_WRITE_FAILURE_META_KEY, JSON.stringify(persisted));
  } catch (metaErr) {
    console.error(
      "[spx-play-outcomes] failed to persist write-failure counter:",
      metaErr instanceof Error ? metaErr.message : metaErr
    );
  }
}

/** Read the durable play-outcome write-failure state (for data-correctness/admin health). */
export async function readPlayWriteFailures(): Promise<PlayWriteFailureState> {
  if (!dbConfigured()) return memoryWriteFailures;
  try {
    // Relative import: under Node 20 + node:test's --experimental-test-module-mocks, a
    // dynamic import() of the "@/" tsconfig-path alias from inside a mocked module graph
    // resolves incorrectly (mis-resolves to a literal "@/lib/db" subpath instead of going
    // through tsx's alias hook) — confirmed via a direct repro; Node 22 doesn't hit this.
    // A same-directory relative specifier sidesteps alias resolution entirely and works on
    // both. All of this file's other dynamic `@/lib/db` imports below use the same fix.
    const { getMeta } = await import("@/lib/db");
    const raw = await getMeta(PLAY_WRITE_FAILURE_META_KEY);
    if (raw) return JSON.parse(raw) as PlayWriteFailureState;
  } catch {
    /* fall through to in-memory */
  }
  return memoryWriteFailures;
}

export function classifyOutcome(close: PlayCloseSnapshot): "win" | "loss" | "breakeven" {
  // Time/thesis/session exits are graded by REALIZED P&L, not by the reason for exiting.
  // A green close is a win even when the trigger was a thesis break or the cash session
  // ending. (Bug fix: THESIS was previously hard-coded to "loss" alongside was_loss, which
  // mislabeled profitable exits — e.g. +2.84 / +7.30 pt closes — as losses and zeroed the
  // public win rate. THETA/SESSION already graded by P&L sign; THESIS now matches them.)
  if (
    close.exit_action === "THETA" ||
    close.exit_action === "SESSION" ||
    close.exit_action === "THESIS"
  ) {
    // Any negative PnL is a loss — the old -1 floor was classifying -0.5 pt exits
    // (−$50/contract) as "breakeven," inflating win-rate statistics.
    if (close.pnl_pts < 0) return "loss";
    if (close.pnl_pts > 0) return "win";
    return "breakeven";
  }
  // A STOP is by construction below entry (long) / above (short) → always a realized loss.
  if (close.exit_action === "STOP") {
    return "loss";
  }
  // TRAIL = protected exit (breakeven lock or price-trail). A scratch or better is a
  // managed win — count it toward win rate. Only classify as loss if slippage put us
  // below entry despite the trail (should not happen in normal flow).
  if (close.exit_action === "TRAIL") {
    if (close.pnl_pts >= 0) return "win";
    if (close.pnl_pts <= -1) return "loss";
    return "breakeven";
  }
  // TARGET, or an UNKNOWN exit: grade by P&L. was_loss stays as the catch-all loss signal
  // for an UNKNOWN action whose small negative PnL wouldn't trip the -1 floor (it is NOT
  // consulted for THESIS/THETA/SESSION above, so a green thesis break is no longer a loss).
  if (close.exit_action === "TARGET" || close.pnl_pts >= 2) return "win";
  if (close.was_loss || close.pnl_pts <= -1) return "loss";
  return "breakeven";
}

export async function recordPlayEntry(snapshot: PlayEntrySnapshot): Promise<number | null> {
  if (!dbConfigured()) {
    const id = nextMemoryPlayId();
    memoryOutcomes.unshift({
      id,
      open_play_id: snapshot.open_play_id,
      session_date: snapshot.session_date,
      direction: snapshot.direction,
      entry_path: snapshot.entry_path,
      grade: snapshot.grade,
      score: snapshot.score,
      confidence: snapshot.confidence,
      entry_price: snapshot.entry_price,
      exit_price: null,
      stop: snapshot.stop,
      target: snapshot.target,
      mfe_pts: 0,
      mae_pts: 0,
      trim_done: false,
      pnl_pts: null,
      outcome: "open",
      exit_action: null,
      headline: snapshot.headline,
      opened_at: snapshot.opened_at,
      closed_at: null,
    });
    return id;
  }

  const { insertPlayOutcomeEntry } = await import("@/lib/db");
  try {
    const id = await insertPlayOutcomeEntry({
      open_play_id: snapshot.open_play_id,
      session_date: snapshot.session_date,
      direction: snapshot.direction,
      entry_path: snapshot.entry_path,
      grade: snapshot.grade,
      score: snapshot.score,
      confidence: snapshot.confidence,
      entry_price: snapshot.entry_price,
      stop: snapshot.stop,
      target: snapshot.target,
      headline: snapshot.headline,
      factors: snapshot.factors,
      confirmations: snapshot.confirmations,
      mtf: snapshot.mtf,
      claude: snapshot.claude,
      option_ticket: snapshot.option_ticket,
      opened_at: snapshot.opened_at,
    });
    // insertPlayOutcomeEntry uses ON CONFLICT (open_play_id) WHERE outcome='open'
    // DO NOTHING — a 0 return means an 'open' outcome row for this play already
    // existed (idempotent re-tick), NOT a failure. id>0 == fresh insert succeeded.
    return id;
  } catch (err) {
    // Surface loudly + bump the durable counter, then RE-THROW so the engine's
    // own try/catch (which logs) still sees it. The engine intentionally does not
    // crash on this — but it MUST be visible, because a swallowed entry-insert is
    // the bug that leaves spx_play_outcomes empty forever.
    await recordPlayWriteFailure("entry", snapshot.open_play_id, err);
    throw err;
  }
}

export async function recordPlayClose(
  openPlayId: number,
  close: PlayCloseSnapshot,
  db?: import("@/lib/db").Db
): Promise<void> {
  const outcome = classifyOutcome(close);

  if (!dbConfigured()) {
    const row = memoryOutcomes.find((r) => r.open_play_id === openPlayId && r.outcome === "open");
    if (!row) return;
    row.exit_price = close.exit_price;
    row.mfe_pts = close.mfe_pts;
    row.mae_pts = close.mae_pts;
    row.trim_done = close.trim_done;
    row.pnl_pts = close.pnl_pts;
    row.outcome = outcome;
    row.exit_action = close.exit_action;
    row.closed_at = new Date().toISOString();
    return;
  }

  const { closePlayOutcomeRow } = await import("@/lib/db");
  try {
    const updated = await closePlayOutcomeRow(openPlayId, {
      exit_price: close.exit_price,
      exit_action: close.exit_action,
      mfe_pts: close.mfe_pts,
      mae_pts: close.mae_pts,
      trim_done: close.trim_done,
      pnl_pts: close.pnl_pts,
      outcome,
      closed_at: new Date().toISOString(),
    }, db);
    // A close UPDATE that affects 0 rows is the silent half of the empty-ledger
    // bug: the play closed in spx_open_play but there was never a matching
    // outcome='open' row to grade (because the entry INSERT had failed). Treat it
    // as a write failure so the counter + logs catch it — but do NOT throw, since
    // this runs inside the close transaction and the play itself IS closing
    // correctly; failing the txn here would needlessly roll back a good close.
    if (updated === 0) {
      await recordPlayWriteFailure(
        "close",
        openPlayId,
        new Error(
          `closePlayOutcomeRow matched 0 rows for open_play_id=${openPlayId} — ` +
            `no outcome='open' row to grade (entry INSERT likely failed earlier).`
        )
      );
    }
  } catch (err) {
    await recordPlayWriteFailure("close", openPlayId, err);
    throw err;
  }
}

export async function fetchPlayOutcomeStats(): Promise<PlayOutcomeStats> {
  if (!dbConfigured()) {
    return computePlayOutcomeStats(memoryOutcomes.filter((r) => r.outcome !== "open"));
  }
  const rows = await fetchClosedPlayOutcomes(500);
  return computePlayOutcomeStats(rows);
}

/**
 * Windowed sibling of fetchPlayOutcomeStats() — same underlying fetcher
 * (fetchClosedPlayOutcomes) and the same pure aggregation
 * (computePlayOutcomeStats), but scoped to plays closed within the last
 * `days` (falling back to opened_at when closed_at is null — the identical
 * day-cutoff pattern getSpxTradeHistory already uses in
 * src/lib/platform/spx-service.ts) instead of the last 500 all-time rows.
 *
 * fetchPlayOutcomeStats() itself deliberately stays all-time: it backs the
 * public track record page (track-record-public.ts), the shadow-recompute
 * cross-check (correctness/track-record-verifier.ts), admin analytics, and
 * more — all of which want the platform's lifetime number. This sibling
 * exists so a caller can compute a *rolling* win rate that lines up with
 * another product's own rolling window (see get_spx_vs_nighthawk_comparison
 * in largo/run-tool.ts) without repurposing — and risking regressing — the
 * all-time function everything else already depends on.
 */
export async function fetchPlayOutcomeStatsForWindow(days: number): Promise<PlayOutcomeStats> {
  const cutoff = Date.now() - days * 86_400_000;
  const inWindow = (r: PlayOutcomeRow) => new Date(r.closed_at ?? r.opened_at).getTime() >= cutoff;
  if (!dbConfigured()) {
    return computePlayOutcomeStats(memoryOutcomes.filter((r) => r.outcome !== "open" && inWindow(r)));
  }
  const rows = await fetchClosedPlayOutcomes(500);
  return computePlayOutcomeStats(rows.filter(inWindow));
}

function bucket(rows: PlayOutcomeRow[], path: PlayEntryPath) {
  const slice = rows.filter((r) => r.entry_path === path);
  const wins = slice.filter((r) => r.outcome === "win").length;
  const losses = slice.filter((r) => r.outcome === "loss").length;
  const count = slice.length;
  const avg_mfe =
    count > 0 ? slice.reduce((s, r) => s + r.mfe_pts, 0) / count : 0;
  const avg_mae =
    count > 0 ? slice.reduce((s, r) => s + r.mae_pts, 0) / count : 0;
  return {
    count,
    wins,
    losses,
    win_rate: count > 0 ? wins / count : 0,
    avg_mfe,
    avg_mae,
  };
}

/** Pure stats aggregation — exported for unit tests. Superseded rows are bookkeeping-only
 * (force-closed stale opens) and never count toward win rate. */
export function computePlayOutcomeStats(rows: PlayOutcomeRow[]): PlayOutcomeStats {
  const closed = rows.filter((r) => r.outcome !== "open" && r.outcome !== "superseded");
  const wins = closed.filter((r) => r.outcome === "win").length;
  const losses = closed.filter((r) => r.outcome === "loss").length;
  const breakeven = closed.filter((r) => r.outcome === "breakeven").length;
  const oldest = closed.length
    ? closed.reduce((a, b) => (a.opened_at < b.opened_at ? a : b)).opened_at
    : null;
  const days_of_data = oldest
    ? Math.max(0, (Date.now() - new Date(oldest).getTime()) / 86_400_000)
    : 0;

  return {
    total_closed: closed.length,
    oldest_closed_at: oldest,
    days_of_data,
    overall: {
      wins,
      losses,
      breakeven,
      win_rate: closed.length > 0 ? wins / closed.length : 0,
    },
    cold_buy: bucket(closed, "cold_buy"),
    watch_promote: bucket(closed, "watch_promote"),
  };
}

export async function fetchRecentPlayOutcomes(limit = 50): Promise<PlayOutcomeRow[]> {
  if (!dbConfigured()) {
    return memoryOutcomes.slice(0, limit);
  }
  const { fetchRecentPlayOutcomeRows } = await import("@/lib/db");
  return fetchRecentPlayOutcomeRows(limit);
}
