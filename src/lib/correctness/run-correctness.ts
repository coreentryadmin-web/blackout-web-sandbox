import "server-only";

import { verifyHeatmapTicker } from "@/lib/correctness/heatmap-verifier";
import { verifyDesk } from "@/lib/correctness/desk-verifier";
import { verifyFlows } from "@/lib/correctness/flows-verifier";
import { verifyNightsWatch } from "@/lib/correctness/nights-watch-verifier";
import { verifyNightHawk } from "@/lib/correctness/nighthawk-verifier";
import { verifyMarketContext } from "@/lib/correctness/market-context-verifier";
import { verifyTrackRecord } from "@/lib/correctness/track-record-verifier";
import { verifyLargo } from "@/lib/correctness/largo-verifier";
import { verifyDataIntegrity } from "@/lib/correctness/data-integrity-verifier";
import {
  type CorrectnessScorecard,
  type TickerScore,
  type CheckResult,
  worstStatus,
} from "@/lib/correctness/types";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";

// ---------------------------------------------------------------------------
// DATA-CORRECTNESS AUDITOR — orchestrator.
//
// ONE run audits the WHOLE platform → one rolled-up scorecard. It runs:
//   • Heat Maps — the layered GEX/VEX/DEX/CHARM verifier per ticker (SPX + the liquid presets).
//   • SPX desk  — spot vs the real index, MAs recomputed from daily bars, IV rank, GEX (shared
//                 UW oracle), dark pool; invariant spot ∈ [day low, day high].
//   • HELIX flows — premium faithfulness + recompute call/put%/net/totals + Σ invariants + recency.
//   • Night's Watch — P&L / mark / Δ/Θ/IV / DTE / breakeven recompute + chain-confirmation.
//   • Night Hawk — latest published edition re-audited vs its dossier snapshot + chain-confirm.
//   • Market context — SPX/VIX vs a 2nd source; breadth recomputed from constituents.
//   • Track record — wins/losses/scratch/hit-rate recomputed from the graded-outcomes ledger.
//   • Largo — numeric-grounding engine (scaffolded; coverage gap until answer+tool-result logging).
//   • Data layer — PG/Redis/pipeline-hop/writer-cron integrity ("are the numbers actually WRITTEN +
//                  FLOWING to the website?" — one level below the per-surface correctness checks).
//
// Each surface produces TickerScore(s) on the SAME scorecard schema (expected/actual/tolerance,
// pass / consistency-only / flag), every metric HONESTLY labeled confirmed (independent oracle) vs
// consistency-only (single source — a coverage gap, never a false green).
//
// CACHE-READER for market-open: reads the shared SPX desk bundle (merged.market_open) — no extra
// upstream. Closed-market thin data is legitimately stale, so most freshness/oracle layers skip then
// (structural invariants/sanity still run and never assert freshness). Surfaces are run SEQUENTIALLY
// to keep the per-run upstream footprint tiny (no fan-out burst); each verifier is internally bounded.
// ---------------------------------------------------------------------------

/** Default verification set — SPX first (the only one with an oracle today), plus the liquid presets. */
const DEFAULT_TICKERS = ["SPX", "SPY", "QQQ", "NVDA"] as const;

/**
 * Parse the configurable ticker set from CORRECTNESS_TICKERS (CSV). Falls back to DEFAULT_TICKERS.
 * Bounded to 10 to keep the run inside the rate budget (the raw-chain shadow recompute fetches one
 * near-money chain per ticker; SPX additionally hits the UW oracle).
 */
export function correctnessTickers(): string[] {
  const raw = process.env.CORRECTNESS_TICKERS?.trim();
  if (!raw) return [...DEFAULT_TICKERS];
  const set = raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z0-9.\-]{1,8}$/.test(t));
  const deduped = Array.from(new Set(set));
  return deduped.length ? deduped.slice(0, 10) : [...DEFAULT_TICKERS];
}

/** Was the market open at run time? Cache-reader over the shared SPX desk bundle. */
async function isMarketOpen(): Promise<boolean> {
  try {
    const { merged } = await loadMergedSpxDesk();
    return merged?.market_open === true;
  } catch {
    return false;
  }
}

function flattenTotals(perTicker: TickerScore[]): CorrectnessScorecard["totals"] {
  let metrics = 0;
  let pass = 0;
  let consistencyOnly = 0;
  let flags = 0;
  let skipped = 0;
  let independentlyConfirmed = 0;
  for (const t of perTicker) {
    for (const m of t.metrics) {
      metrics++;
      if (m.status === "pass") pass++;
      else if (m.status === "consistency-only") consistencyOnly++;
      else if (m.status === "flag") flags++;
      else skipped++;
      if (m.independentlyConfirmed) independentlyConfirmed++;
    }
  }
  return { metrics, pass, consistencyOnly, flags, skipped, independentlyConfirmed };
}

function collectFlags(perTicker: TickerScore[]): CheckResult[] {
  const out: CheckResult[] = [];
  for (const t of perTicker) for (const m of t.metrics) for (const c of m.checks) {
    if (c.outcome === "flag") out.push(c);
  }
  return out;
}

function collectCoverageGaps(
  perTicker: TickerScore[]
): CorrectnessScorecard["coverageGaps"] {
  const gaps: CorrectnessScorecard["coverageGaps"] = [];
  for (const t of perTicker) {
    for (const m of t.metrics) {
      // A metric that ran cleanly but no oracle confirmed it is a coverage gap.
      if (m.status === "consistency-only") {
        const reason =
          m.checks.find((c) => c.layer === "cross-provider")?.detail ??
          "No independent second source confirmed this metric.";
        gaps.push({ ticker: t.ticker, metric: m.metric, reason });
      }
    }
  }
  return gaps;
}

/**
 * Run the full data-correctness sweep for the Heat Maps surface. Never throws — a thrown ticker
 * verification degrades to a skipped TickerScore. The returned scorecard is the structured artifact
 * the cron persists, renders to markdown, and alerts on.
 */
export async function runHeatmapCorrectness(
  tickers: string[] = correctnessTickers()
): Promise<CorrectnessScorecard> {
  const ranAt = new Date().toISOString();
  const marketOpen = await isMarketOpen();

  // Verify tickers sequentially in small steps: the shadow recompute fetches one near-money chain
  // per ticker through the rate-limited funnel, and SPX hits the UW 2-RPS oracle — sequential keeps
  // the per-run upstream footprint tiny and predictable (no fan-out burst).
  const perTicker: TickerScore[] = [];
  for (const ticker of tickers) {
    try {
      perTicker.push(await verifyHeatmapTicker(ticker, marketOpen));
    } catch (err) {
      perTicker.push({
        ticker: ticker.toUpperCase(),
        status: "skipped",
        metrics: [
          {
            ticker: ticker.toUpperCase(),
            metric: "run",
            status: "skipped",
            independentlyConfirmed: false,
            checks: [
              {
                id: `${ticker}:run:invariant:threw`,
                layer: "invariant",
                metric: "run",
                outcome: "skipped",
                detail: `Ticker verification threw: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          },
        ],
      });
    }
  }

  const totals = flattenTotals(perTicker);
  const flags = collectFlags(perTicker);
  const coverageGaps = collectCoverageGaps(perTicker);

  const note =
    "TODAY: SPX King strike + net-GEX sign are INDEPENDENTLY CONFIRMED against the UW native GEX " +
    "ladder when it answers (#104 oracle). All other metrics (net magnitudes, walls, flip, per-cell " +
    "$-gamma, cross-tool agreement) are CONSISTENCY-CHECKED — proven internally consistent and " +
    "invariant-clean, but NOT confirmed by a second independent source. Consistency-only is a " +
    "coverage gap, never a guarantee.";

  return {
    ranAt,
    surface: "heatmap",
    marketOpen,
    perTicker,
    totals,
    flags,
    coverageGaps,
    note,
  };
}

/**
 * Run the FULL-PLATFORM data-correctness sweep — Heat Maps + every other numeric surface — into ONE
 * rolled-up scorecard. Surfaces run sequentially; each verifier is internally bounded + a thrown
 * verifier degrades to a skipped TickerScore (one surface can't abort the platform sweep).
 */
export async function runFullCorrectness(
  tickers: string[] = correctnessTickers()
): Promise<CorrectnessScorecard> {
  const ranAt = new Date().toISOString();
  const marketOpen = await isMarketOpen();

  const perTicker: TickerScore[] = [];

  // ── Heat Maps (per-ticker; SPX first — the only one with a GEX oracle today) ──
  for (const ticker of tickers) {
    perTicker.push(await safeSurface(`heatmap:${ticker}`, ticker.toUpperCase(), () => verifyHeatmapTicker(ticker, marketOpen)));
  }

  // ── Every other surface (each is its own synthetic ticker on the same schema) ──
  const surfaces: Array<[string, string, () => Promise<TickerScore>]> = [
    ["desk", "SPX", () => verifyDesk(marketOpen)],
    ["flows", "FLOWS", () => verifyFlows(marketOpen)],
    ["nights-watch", "NW", () => verifyNightsWatch(marketOpen)],
    ["nighthawk", "NIGHTHAWK", () => verifyNightHawk(marketOpen)],
    ["market-context", "MARKET", () => verifyMarketContext(marketOpen)],
    ["track-record", "TRACKREC", () => verifyTrackRecord(marketOpen)],
    ["largo", "LARGO", () => verifyLargo(marketOpen)],
    ["data-integrity", "DATALAYER", () => verifyDataIntegrity(marketOpen)],
  ];
  for (const [name, label, run] of surfaces) {
    perTicker.push(await safeSurface(name, label, run));
  }

  const totals = flattenTotals(perTicker);
  const flags = collectFlags(perTicker);
  const coverageGaps = collectCoverageGaps(perTicker);

  const note =
    "FULL-PLATFORM sweep. INDEPENDENTLY CONFIRMED when a 2nd source agrees: Heat Maps + SPX-desk GEX " +
    "King/net-sign (UW oracle), desk spot (Polygon I:SPX), market-context SPX/VIX (2nd index snapshot), " +
    "and chain-confirmed Night-Hawk strikes/premiums + Night's-Watch held strikes (live option chain). " +
    "Track-record W/L/scratch/hit-rate is CONFIRMED-AGAINST-LEDGER (recompute == served == invariant). " +
    "CONSISTENCY-ONLY (coverage gaps, single source): HELIX flow aggregates (UW sole provider), MAs / " +
    "GEX magnitude / walls / flip, NW mark+greek VALUES (no 2nd pricing oracle), sector %, NH dossier " +
    "cross-checks. Largo numeric-grounding is SCAFFOLDED — coverage gap pending answer+tool-result " +
    "logging. DATA-LAYER integrity (PG freshness/row-count/garbage-rate, Redis presence/TTL/sanity, " +
    "writer-cron liveness) is asserted as PASS where it holds — an independent second VIEW of the " +
    "pipeline, market-hours-gated so off-window quiet is skipped not flagged; cross-hop spot/edition " +
    "reconciliations stay consistency-only (single underlying). Consistency-only is never a false green.";

  return {
    ranAt,
    surface: "platform",
    marketOpen,
    perTicker,
    totals,
    flags,
    coverageGaps,
    note,
  };
}

/** Run one surface defensively — a throw becomes a skipped TickerScore, never an abort. */
async function safeSurface(
  name: string,
  label: string,
  run: () => Promise<TickerScore>
): Promise<TickerScore> {
  try {
    return await run();
  } catch (err) {
    return {
      ticker: label,
      status: "skipped",
      metrics: [
        {
          ticker: label,
          metric: "run",
          status: "skipped",
          independentlyConfirmed: false,
          checks: [
            {
              id: `${label}:${name}:invariant:threw`,
              layer: "invariant",
              metric: "run",
              outcome: "skipped",
              detail: `Surface "${name}" threw: ${err instanceof Error ? err.message : String(err)} — skipped, not flagged.`,
            },
          ],
        },
      ],
    };
  }
}

/** Worst overall status across the whole scorecard (for the cron payload / chip). */
export function scorecardStatus(card: CorrectnessScorecard): TickerScore["status"] {
  return worstStatus(card.perTicker.map((t) => t.status));
}

/**
 * Render the scorecard to a compact markdown report (for docs/auto/data-correctness-<date>.md and
 * the cron payload). Shows per-metric status, confirmed-vs-consistency-only, and expected/actual on
 * every flag.
 */
export function renderScorecardMarkdown(card: CorrectnessScorecard): string {
  const lines: string[] = [];
  const date = card.ranAt.slice(0, 10);
  lines.push(`# Data-Correctness Scorecard — ${card.surface} — ${date}`);
  lines.push("");
  lines.push(`- Ran at: \`${card.ranAt}\``);
  lines.push(`- Market open: **${card.marketOpen ? "yes" : "no"}**`);
  lines.push(
    `- Totals: ${card.totals.metrics} metrics — ` +
      `**${card.totals.pass} confirmed**, ${card.totals.consistencyOnly} consistency-only, ` +
      `**${card.totals.flags} FLAGGED**, ${card.totals.skipped} skipped ` +
      `(${card.totals.independentlyConfirmed} independently-confirmed)`
  );
  lines.push("");
  lines.push(`> ${card.note}`);
  lines.push("");

  if (card.flags.length) {
    lines.push("## 🚨 FLAGS");
    lines.push("");
    lines.push("| Layer | Metric | Detail | Expected | Actual | Tol |");
    lines.push("|---|---|---|---|---|---|");
    for (const f of card.flags) {
      lines.push(
        `| ${f.layer} | ${f.metric} | ${escapePipes(f.detail)} | ${fmtCell(f.expected)} | ${fmtCell(f.actual)} | ${fmtCell(f.tolerance)} |`
      );
    }
    lines.push("");
  } else {
    lines.push("## No flags this run ✅");
    lines.push("");
  }

  lines.push("## Per-ticker / per-metric");
  lines.push("");
  for (const t of card.perTicker) {
    lines.push(`### ${t.ticker} — ${statusBadge(t.status)}`);
    lines.push("");
    lines.push("| Metric | Status | Independently confirmed? | Checks |");
    lines.push("|---|---|---|---|");
    for (const m of t.metrics) {
      lines.push(
        `| ${m.metric} | ${statusBadge(m.status)} | ${m.independentlyConfirmed ? "✅ yes" : "— consistency-only"} | ${m.checks.length} |`
      );
    }
    lines.push("");
    // Detail every check for traceability.
    for (const m of t.metrics) {
      for (const c of m.checks) {
        lines.push(`- \`${c.layer}\` **${c.metric}** [${c.outcome}] — ${c.detail}`);
      }
    }
    lines.push("");
  }

  if (card.coverageGaps.length) {
    lines.push("## Coverage gaps (consistency-only — NOT independently confirmed)");
    lines.push("");
    for (const g of card.coverageGaps) {
      lines.push(`- **${g.ticker} / ${g.metric}** — ${g.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function statusBadge(s: string): string {
  switch (s) {
    case "pass":
      return "✅ confirmed";
    case "consistency-only":
      return "🟡 consistency-only";
    case "flag":
      return "🚨 FLAG";
    default:
      return "⚪ skipped";
  }
}
function fmtCell(v: number | string | null | undefined): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(v);
  return escapePipes(String(v));
}
function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|");
}
