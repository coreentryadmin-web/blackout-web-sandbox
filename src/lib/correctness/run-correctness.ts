import "server-only";

import { verifyHeatmapTicker } from "@/lib/correctness/heatmap-verifier";
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
// Runs the layered Heat Maps verifier for SPX + a small configurable ticker set, rolls
// the per-ticker results into one SCORECARD, and exposes the structured result so the
// cron can persist a summary + markdown + fire Discord. Extensible: when desk/flows/
// Night's Watch verifiers land they slot in alongside verifyHeatmapTicker here.
//
// CACHE-READER for market-open: reads the shared SPX desk bundle (merged.market_open) —
// no extra upstream. Closed-market thin data is legitimately stale, so most layers skip
// then (only structural invariants/sanity still run and never assert freshness).
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
