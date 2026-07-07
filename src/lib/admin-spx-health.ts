// Admin SPX health snapshot — the data source behind AdminBieDashboard's SPX
// health panel (see AdminBieDashboard.tsx and
// src/app/api/admin/spx/health/route.ts). Answers "is the SPX play engine
// alive and what is it seeing right now" for an admin glancing at the BIE
// control room, without duplicating the full SPX admin dashboard
// (admin-spx-dashboard.ts / /api/admin/spx/dashboard) which already exists
// for deep SPX debugging (analytics, lotto, power-hour, issues, terminal
// feed) and is a much heavier read.
//
// STRICTLY READ-ONLY, by construction, not just by convention:
//   - Desk + play state come from loadMergedSpxDesk() + readSpxPlaySnapshot(),
//     the EXACT SAME pair /api/market/spx/play (the member-facing route) and
//     the existing /api/admin/spx/dashboard's `live=1` dry-run path already
//     call. readSpxPlaySnapshot() -> evaluateSpxPlay(desk, technicals,
//     { mutate:false }) — tracing spx-play-engine.ts confirms every `if
//     (mutate)` branch (openPlay/closeOpenPlay/recordBuy/updateOpenPlay,
//     notifyPlayDiscord, watch-record writes) is skipped when mutate is
//     false, so this call can never open/close/trim a position or fire a
//     Discord alert. The only unconditional side effect of calling
//     evaluateSpxPlay at all is the pre-existing "shadow mode" observational
//     factor logging (spx-signal-log.ts) — that already fires on every
//     member SPX Slayer poll today; this panel does not add a new class of
//     write, just one more read of the same already-continuously-run path.
//   - fetchRecentSpxSignals() is a plain SELECT (spx-signal-log.ts).
//   - No call here ever reaches openPlay/closeOpenPlay/recordBuy/
//     updateOpenPlay/notifyPlayDiscord directly, and none ever will without
//     changing this file — grep this module for those names as a tripwire.
//
// Every external call is individually try/caught so one degraded leg (e.g.
// desk build fails) still returns a usable snapshot for the rest — the panel
// itself must never take down the rest of AdminBieDashboard on a partial
// failure (see this file's `errors` field and the panel's own fail-open
// rendering in AdminBieDashboard.tsx).
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { readSpxPlaySnapshot } from "@/features/spx/lib/spx-evaluator";
import { buildPlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { deskAgeSec, isDeskStale } from "@/features/spx/lib/spx-desk-stale";
import { playGexStaleMaxSec } from "@/features/spx/lib/spx-play-config";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";
import { fetchRecentSpxSignals, type SpxSignalLogRow } from "@/features/spx/lib/spx-signal-log";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";

export type SpxHealthPlaySummary = {
  available: boolean;
  phase: SpxPlayPayload["phase"];
  action: SpxPlayPayload["action"];
  direction: SpxPlayPayload["direction"];
  grade: string;
  score: number;
  confidence: number;
  gates: {
    passed: boolean;
    blocks: string[];
    warnings: string[];
    entry_mode: string;
  };
  signal_committed: boolean;
  as_of: string;
};

export type SpxHealthDeskSummary = {
  available: boolean;
  price: number | null;
  market_open: boolean;
  age_sec: number | null;
  stale: boolean;
  stale_threshold_sec: number;
};

export type SpxHealthSignalRow = {
  id: number;
  action: string;
  bias: string;
  score: number;
  confidence: number;
  headline: string;
  created_at: string;
};

export type SpxHealthSnapshot = {
  generated_at: string;
  play: SpxHealthPlaySummary | null;
  desk: SpxHealthDeskSummary;
  flow_feed_live: boolean;
  recent_signals: SpxHealthSignalRow[];
  // Partial-failure notes — populated when one leg degrades but the overall
  // snapshot still returns 200 with whatever else succeeded. Never thrown.
  errors: string[];
};

function summarizePlay(play: SpxPlayPayload): SpxHealthPlaySummary {
  return {
    available: play.available,
    phase: play.phase,
    action: play.action,
    direction: play.direction,
    grade: play.grade,
    score: play.score,
    confidence: play.confidence,
    gates: {
      passed: play.gates.passed,
      blocks: play.gates.blocks,
      warnings: play.gates.warnings,
      entry_mode: play.gates.entry_mode,
    },
    signal_committed: play.signal_committed,
    as_of: play.as_of,
  };
}

function summarizeSignal(row: SpxSignalLogRow): SpxHealthSignalRow {
  return {
    id: row.id,
    action: row.action,
    bias: row.bias,
    score: row.score,
    confidence: row.confidence,
    headline: row.headline,
    created_at: row.created_at,
  };
}

export async function fetchSpxHealthSnapshot(): Promise<SpxHealthSnapshot> {
  const errors: string[] = [];

  // Desk and play are fetched together — a play snapshot without its desk is
  // meaningless, so a desk failure degrades both rather than reporting a
  // half-consistent state.
  let desk: Awaited<ReturnType<typeof loadMergedSpxDesk>>["merged"] | null = null;
  let play: SpxPlayPayload | null = null;
  try {
    const { merged } = await loadMergedSpxDesk();
    desk = merged;
    let technicals: PlayTechnicals | null = null;
    try {
      technicals = await buildPlayTechnicals(merged.price, {
        vwap: merged.vwap,
        pdh: merged.pdh,
        pdl: merged.pdl,
        hod: merged.hod,
        lod: merged.lod,
      });
    } catch (e) {
      errors.push(`technicals: ${e instanceof Error ? e.message : "failed"}`);
    }
    play = await readSpxPlaySnapshot(merged, technicals);
  } catch (e) {
    errors.push(`desk/play: ${e instanceof Error ? e.message : "failed"}`);
  }

  const [flowFeedLive, recentSignalRows] = await Promise.all([
    isFlowFrameFreshAnywhere().catch((e) => {
      errors.push(`flow feed probe: ${e instanceof Error ? e.message : "failed"}`);
      return false;
    }),
    fetchRecentSpxSignals(8).catch((e) => {
      errors.push(`signal log: ${e instanceof Error ? e.message : "failed"}`);
      return [] as SpxSignalLogRow[];
    }),
  ]);

  const ageSec = desk ? deskAgeSec(desk.polled_at, desk.as_of) : null;
  // Same threshold the play engine itself uses to decide desk staleness
  // (spx-play-engine.ts line ~181, spx-play-gates.ts) — this panel reports
  // "stale" exactly when the live engine would also treat the desk as too
  // old to trust, not an independently invented number.
  const staleThresholdSec = playGexStaleMaxSec();

  return {
    generated_at: new Date().toISOString(),
    play: play ? summarizePlay(play) : null,
    desk: {
      available: desk?.available ?? false,
      price: desk?.price ?? null,
      market_open: desk?.market_open ?? false,
      age_sec: ageSec,
      stale: isDeskStale(ageSec, staleThresholdSec),
      stale_threshold_sec: staleThresholdSec,
    },
    flow_feed_live: flowFeedLive,
    recent_signals: recentSignalRows.map(summarizeSignal),
    errors,
  };
}
