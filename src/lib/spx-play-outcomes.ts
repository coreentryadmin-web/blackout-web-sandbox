import { dbConfigured, ensureSchema } from "@/lib/db";
import type { ClaudePlayVerdict } from "@/lib/spx-play-claude";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import type { MtfHybrid } from "@/lib/spx-play-mtf";
import type { OptionTicket } from "@/lib/spx-play-options";
import type { SpxPlayDirection, SpxSignalFactor } from "@/lib/spx-signals";

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

export type PlayExitAction = "STOP" | "TARGET" | "THESIS" | "SESSION" | "THETA" | "UNKNOWN";

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
  outcome: "open" | "win" | "loss" | "breakeven";
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
let memoryNextId = 1;

function classifyOutcome(close: PlayCloseSnapshot): "win" | "loss" | "breakeven" {
  if (close.exit_action === "THETA" || close.exit_action === "SESSION") {
    if (close.pnl_pts <= -1) return "loss";
    if (close.pnl_pts >= 2) return "win";
    return "breakeven";
  }
  if (close.was_loss || close.exit_action === "STOP" || close.exit_action === "THESIS") {
    return "loss";
  }
  if (close.exit_action === "TARGET" || close.pnl_pts >= 2) return "win";
  if (close.pnl_pts <= -1) return "loss";
  return "breakeven";
}

export async function recordPlayEntry(snapshot: PlayEntrySnapshot): Promise<number | null> {
  if (!dbConfigured()) {
    const id = memoryNextId++;
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

  await ensureSchema();
  const { insertPlayOutcomeEntry } = await import("@/lib/db");
  return insertPlayOutcomeEntry({
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
}

export async function recordPlayClose(
  openPlayId: number,
  close: PlayCloseSnapshot
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

  await ensureSchema();
  const { closePlayOutcomeRow } = await import("@/lib/db");
  await closePlayOutcomeRow(openPlayId, {
    exit_price: close.exit_price,
    exit_action: close.exit_action,
    mfe_pts: close.mfe_pts,
    mae_pts: close.mae_pts,
    trim_done: close.trim_done,
    pnl_pts: close.pnl_pts,
    outcome,
    closed_at: new Date().toISOString(),
  });
}

export async function fetchPlayOutcomeStats(): Promise<PlayOutcomeStats> {
  if (!dbConfigured()) {
    return aggregateStats(memoryOutcomes.filter((r) => r.outcome !== "open"));
  }
  await ensureSchema();
  const { fetchClosedPlayOutcomes } = await import("@/lib/db");
  const rows = await fetchClosedPlayOutcomes(500);
  return aggregateStats(rows);
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

function aggregateStats(rows: PlayOutcomeRow[]): PlayOutcomeStats {
  const closed = rows.filter((r) => r.outcome !== "open");
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
  await ensureSchema();
  const { fetchRecentPlayOutcomeRows } = await import("@/lib/db");
  return fetchRecentPlayOutcomeRows(limit);
}
