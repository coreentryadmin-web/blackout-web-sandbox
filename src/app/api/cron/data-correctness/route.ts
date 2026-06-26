// Cron: DATA-CORRECTNESS AUDITOR — continuously verify the numbers the platform SHOWS are correct.
//
// Heat Maps (GEX/VEX/DEX/CHARM) is the first + primary target. This runs a LAYERED verifier
// (strongest → weakest) per ticker and builds a SCORECARD:
//   L1 shadow-recompute — independent re-derivation of net/King/flip/walls from the raw chain
//   L2 invariants       — relationships that MUST hold (Σ strikes == total, King == argmax|net|, …)
//   L3 sanity bounds    — no NaN/Inf, plausible magnitudes, valid expiries, level near spot
//   L4 cross-provider   — UW native GEX oracle (SPX): King strike + net-GEX sign (independently confirmed)
//   L5 cross-tool       — same spot/flip/walls across getGexPositioning, SPX desk
//   L6 freshness        — served asof within TTL during RTH (never stale-shown-as-live)
//
// HONESTY: a metric with no second source is reported "consistency-only" (a coverage gap), never a
// false green. Only SPX King + net-GEX sign are independently confirmed today (#104 UW oracle).
//
// AUTH: Bearer CRON_SECRET (isCronAuthorized), force-dynamic, bounded maxDuration. Self-skips outside
// the RTH window unless ?force=1. Fires notifyOpsDiscord({critical}) on any FLAG and {warning} on new
// consistency-only coverage gaps. Persists the run via logCronRun and emits a markdown scorecard to
// docs/auto/data-correctness-<date>.md (best-effort; skipped silently on a read-only FS).

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isSpxEngineCronWindow } from "@/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import {
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

  try {
    const tickers = correctnessTickers();
    const card = await runHeatmapCorrectness(tickers);
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
      // Read-only FS in prod (Railway) → skip the file; the structured result is still in the run log.
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
