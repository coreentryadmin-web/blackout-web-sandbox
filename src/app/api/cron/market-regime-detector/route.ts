// Market Regime Detector — runs every 5 min during RTH.
//
// Reads the already-cached SPX desk (no upstream cost) and recent HELIX flows
// (Postgres, cheap) to derive a composite regime snapshot + flow anomalies.
// Writes directly to market_regime and flow_anomalies tables.
//
// Fixes P1-A: these tables had no writer, leaving FlowAnomalyBanner and the
// nighthawk-morning-confirm cron reading empty/stale data every run.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isSpxEngineCronWindow } from "@/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { requireDatabaseInProduction } from "@/lib/db";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { dbQuery } from "@/lib/db";
import { deriveComposite } from "./derive-composite";
import {
  detectFlowAnomalies,
  LARGE_PRINT_THRESHOLD,
  SKEW_RATIO_THRESHOLD,
  type FlowAnomalyNearMiss,
} from "./flow-anomaly-detection";
import { persistFlowAnomalyNearMisses } from "@/lib/platform/flow-anomaly-near-misses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Regime derivation ─────────────────────────────────────────────────────────

function deriveVolRegime(ivRank: number | null): string {
  if (ivRank == null) return "unknown";
  if (ivRank >= 70) return "elevated";
  if (ivRank <= 30) return "compressed";
  return "normal";
}

function deriveTrendRegime(deskRegime: string): string {
  const r = (deskRegime ?? "").toUpperCase();
  if (r.includes("TREND_UP") || r.includes("BULLISH") || r.includes("BREAKOUT")) return "up";
  if (r.includes("TREND_DOWN") || r.includes("BEARISH") || r.includes("BREAKDOWN")) return "down";
  return "sideways";
}

function deriveFlowRegime(
  callPremium: number | null,
  putPremium: number | null
): { regime: string; ratio: number } {
  const c = callPremium ?? 0;
  const p = putPremium ?? 0;
  const total = c + p;
  if (total === 0) return { regime: "neutral", ratio: 1 };
  const ratio = p > 0 ? c / p : c > 0 ? 99 : 1;
  if (ratio >= 1.5) return { regime: "bullish", ratio };
  if (ratio <= 1 / 1.5) return { regime: "bearish", ratio };
  return { regime: "mixed", ratio };
}

// ── Anomaly detection ──────────────────────────────────────────────────────────
// detectFlowAnomalies() itself now lives in ./flow-anomaly-detection.ts (same split
// derive-composite.ts already needed — Next.js's route-export validator rejects any
// named export from route.ts besides the HTTP method handlers, so a testable pure
// function can't live here). See that file's module doc for the near-miss capture
// (task #131/HELIX) this route now wires up below.

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isSpxEngineCronWindow()) {
    const payload = { ok: true, skipped: true, reason: "Outside RTH window" };
    await logCronRun("market-regime-detector", started, payload);
    return NextResponse.json(payload);
  }

  // Always collected (cheap — a handful of array pushes per candidate ticker);
  // whether it's ever WRITTEN anywhere is decided below, after the dedup loop adds
  // its own DEDUP_SUPPRESSED entries alongside these BELOW_THRESHOLD ones.
  const nearMisses: FlowAnomalyNearMiss[] = [];

  try {
    const [{ merged }, anomalies] = await Promise.all([
      loadMergedSpxDesk(),
      detectFlowAnomalies({ nearMisses }),
    ]);

    if (!merged.available) {
      const payload = { ok: true, skipped: true, reason: "Desk not available" };
      await logCronRun("market-regime-detector", started, payload);
      return NextResponse.json(payload);
    }

    // Derive sub-regimes
    const gex_regime = merged.gamma_regime ?? "unknown";
    const vol_regime = deriveVolRegime(merged.uw_iv_rank);
    const trend_regime = deriveTrendRegime(merged.regime);

    // Use 0DTE flow for real-time flow regime; fall back to tide
    const callPrem = merged.flow_0dte_call_premium ?? merged.tide_call_premium ?? null;
    const putPrem = merged.flow_0dte_put_premium ?? merged.tide_put_premium ?? null;
    const { regime: flow_regime, ratio: flow_ratio } = deriveFlowRegime(callPrem, putPrem);

    const { composite, playbook } = deriveComposite(gex_regime, trend_regime, flow_regime);

    const raw = {
      gex_regime, vol_regime, trend_regime, flow_regime, composite, playbook,
      net_gex: merged.gex_net, iv_percentile: merged.uw_iv_rank,
      above_vwap: merged.above_vwap, flow_ratio,
    };

    // Write regime snapshot
    await dbQuery(
      `INSERT INTO market_regime (gex_regime, vol_regime, trend_regime, flow_regime, composite, playbook, net_gex, iv_percentile, above_vwap, flow_ratio, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [gex_regime, vol_regime, trend_regime, flow_regime, composite, playbook,
       merged.gex_net, merged.uw_iv_rank, merged.above_vwap, flow_ratio, JSON.stringify(raw)]
    );

    // Write anomalies (skip duplicates by checking if same type+ticker detected in last 15 min)
    let anomaliesInserted = 0;
    for (const a of anomalies) {
      const existing = await dbQuery(
        `SELECT 1 FROM flow_anomalies
         WHERE anomaly_type = $1 AND COALESCE(ticker,'') = COALESCE($2,'')
           AND detected_at > NOW() - INTERVAL '15 minutes'
         LIMIT 1`,
        [a.type, a.ticker]
      );
      if ((existing.rowCount ?? 0) === 0) {
        await dbQuery(
          `INSERT INTO flow_anomalies (anomaly_type, ticker, detail, premium, direction, severity, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [a.type, a.ticker, a.detail, a.premium, a.direction, a.severity, JSON.stringify(a)]
        );
        anomaliesInserted++;
      } else {
        // This anomaly cleared its real threshold (it's a fully-formed Anomaly,
        // not a below-threshold candidate) but the 15-min dedup window already has
        // a match, so the INSERT above never happens — a SECOND, structurally
        // different way a computed anomaly leaves no trace in flow_anomalies.
        // Task #131: record it with reason DEDUP_SUPPRESSED (never BELOW_THRESHOLD
        // — that reason is reserved for detectFlowAnomalies' own sub-threshold
        // candidates) so "why didn't X fire again" is distinguishable from "X never
        // cleared the bar at all."
        nearMisses.push({
          anomaly_type: a.type,
          ticker: a.ticker,
          reason: "DEDUP_SUPPRESSED",
          metric_value: a.metric_value,
          threshold: a.type === "LARGE_PREMIUM_PRINT" ? LARGE_PRINT_THRESHOLD : SKEW_RATIO_THRESHOLD,
          premium: a.premium,
          direction: a.direction,
          severity: a.severity,
          detail: a.detail,
        });
      }
    }

    // Near-miss log (task #131) — best-effort, throttled write; a failure here must
    // never affect the real regime/anomaly writes above, which have already
    // committed by this point.
    const nearMissesLogged = await persistFlowAnomalyNearMisses(nearMisses).catch(() => 0);

    const payload = {
      ok: true,
      composite,
      gex_regime,
      vol_regime,
      trend_regime,
      flow_regime,
      anomalies_found: anomalies.length,
      anomalies_inserted: anomaliesInserted,
      near_misses_found: nearMisses.length,
      near_misses_logged: nearMissesLogged,
      ms: Date.now() - started,
    };
    await logCronRun("market-regime-detector", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[market-regime-detector]", detail);
    await logCronRun("market-regime-detector", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Regime detector failed" }, { status: 500 });
  }
}
