// Cron: DATA-CORRECTNESS AUDITOR — continuously verify the numbers the platform SHOWS are correct.
//
// ONE run audits the WHOLE platform → one rolled-up SCORECARD. Surfaces covered:
//   • Heat Maps (GEX/VEX/DEX/CHARM) — the original layered per-ticker verifier
//   • SPX desk      — spot vs the real index, MAs from daily bars, IV rank, GEX, dark pool
//   • HELIX flows   — premium faithfulness + recompute call/put%/net/totals + Σ invariants + recency
//   • Night Hawk    — latest published edition re-audited vs its dossier snapshot + chain-confirm
//   • Market context— SPX/VIX vs a 2nd source; breadth recomputed from constituents
//   • Track record  — wins/losses/scratch/hit-rate recomputed from the graded-outcomes ledger
//   • Largo         — numeric-grounding engine (scaffolded; coverage gap until answer logging lands)
//
// Each surface emits the SAME layered CheckResults (shadow-recompute / invariant / sanity / cross-
// provider / cross-tool / freshness) on one scorecard schema.
//
// HONESTY: a metric with no second source is reported "consistency-only" (a coverage gap), never a
// false green. See the rolled-up scorecard `note` for what is independently-confirmed vs consistency-only.
//
// AUTH: Bearer CRON_SECRET (isCronAuthorized), force-dynamic, bounded maxDuration. Self-skips outside
// the RTH window unless ?force=1. Fires notifyOpsDiscord({critical}) on any FLAG and {warning} on new
// consistency-only coverage gaps. Persists the run via logCronRun and emits a markdown scorecard to
// docs/auto/data-correctness-<date>.md (best-effort; skipped silently on a read-only FS).
//
// ?surface=heatmap runs ONLY the Heat Maps (GEX/VEX/DEX/CHARM) verifier instead of the full 7-surface
// platform sweep — the full sweep's sequential per-surface upstream calls can run long enough during
// RTH to trip an edge gateway timeout (~100s, well inside the route's own maxDuration=120) and return
// a bodyless 524; this gives a fast, targeted path to the one surface most worth re-checking on demand.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import {
  runFullCorrectness,
  runHeatmapCorrectness,
  correctnessTickers,
  renderScorecardMarkdown,
  scorecardStatus,
} from "@/lib/correctness/run-correctness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isSpxEngineCronWindow()) {
    const payload = { ok: true, skipped: true, reason: "Outside RTH window (7:00–16:15 ET weekdays)" };
    await logCronRun("data-correctness", started, payload);
    return NextResponse.json(payload);
  }

  // Full-platform sweep sequentially runs 8+ surfaces (each with its own upstream fetches) and
  // can run long enough during RTH to trip an edge gateway timeout (~100s) before the platform's
  // own maxDuration=120 ever kicks in — surfacing as a 524 with zero response body. `surface=heatmap`
  // runs ONLY the Heat Maps (GEX/VEX/DEX/CHARM) verifier so a targeted re-check (or this exact
  // symptom) doesn't require paying for the other 7 surfaces' runtime.
  const surface = req.nextUrl.searchParams.get("surface");

  try {
    const tickers = correctnessTickers();
    const card = surface === "heatmap" ? await runHeatmapCorrectness(tickers) : await runFullCorrectness(tickers);
    const overall = scorecardStatus(card);

    // ── Markdown scorecard → docs/auto/data-correctness-<date>.md (best-effort) ──
    let mdPath: string | null = null;
    try {
      const date = card.ranAt.slice(0, 10);
      const dir = path.join(process.cwd(), "docs", "auto");
      await fs.mkdir(dir, { recursive: true });
      mdPath = path.join(dir, `data-correctness-${date}.md`);
      await fs.writeFile(mdPath, renderScorecardMarkdown(card), "utf8");
    } catch (fsErr) {
      // Read-only FS in prod (ECS) → skip the file; the structured result is still in the run log.
      console.info(`[data-correctness] markdown emit skipped: ${fsErr instanceof Error ? fsErr.message : String(fsErr)}`);
      mdPath = null;
    }

    // ── Alerts ──────────────────────────────────────────────────────────────
    // CRITICAL on any FLAG (a definite/probable wrong number on a user-facing surface).
    if (card.flags.length > 0) {
      const body = card.flags
        .slice(0, 8)
        .map((f) => `• [${f.layer}/${f.metric}] ${f.detail}`)
        .join("\n")
        .slice(0, 1500);
      void notifyOpsDiscord({
        title: `Data-correctness FLAG ×${card.flags.length} (${card.surface})`,
        body: `${body}${card.flags.length > 8 ? `\n…and ${card.flags.length - 8} more.` : ""}`,
        severity: "critical",
      }).catch(() => undefined);
    } else if (card.marketOpen && card.totals.consistencyOnly > 0 && card.totals.independentlyConfirmed === 0) {
      // WARNING when the run is entirely consistency-only during RTH (the oracle answered for nothing)
      // — surfaces the coverage gap loudly instead of letting an all-yellow run read as all-green.
      void notifyOpsDiscord({
        title: `Data-correctness: 0 independently-confirmed metrics (${card.surface})`,
        body:
          `${card.totals.consistencyOnly} metrics passed consistency checks but NONE were confirmed by a ` +
          `second source this run (UW oracle absent?). Coverage gap — not a guarantee. ` +
          `Gaps: ${card.coverageGaps.slice(0, 5).map((g) => `${g.ticker}/${g.metric}`).join(", ")}.`,
        severity: "warning",
      }).catch(() => undefined);
    }

    const payload = {
      ok: card.flags.length === 0,
      surface: card.surface,
      market_open: card.marketOpen,
      overall_status: overall,
      tickers,
      totals: card.totals,
      flags: card.flags.map((f) => ({ layer: f.layer, metric: f.metric, detail: f.detail })),
      coverage_gaps: card.coverageGaps.length,
      ...(mdPath ? { report: path.relative(process.cwd(), mdPath) } : {}),
      ...(card.flags.length > 0 ? { error: `${card.flags.length} correctness flag(s)` } : {}),
    };
    await logCronRun("data-correctness", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[data-correctness]", detail);
    await logCronRun("data-correctness", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Data-correctness sweep failed" }, { status: 500 });
  }
}
