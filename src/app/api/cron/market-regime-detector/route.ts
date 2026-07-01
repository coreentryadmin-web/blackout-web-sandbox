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
import { fetchRecentFlows, dbQuery } from "@/lib/db";
import { deriveComposite } from "./derive-composite";

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

type Anomaly = {
  type: string;
  ticker: string | null;
  detail: string;
  premium: number | null;
  direction: string | null;
  severity: string;
};

async function detectFlowAnomalies(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];
  try {
    // Fetch recent 30-min HELIX flows for anomaly detection
    const rows = await fetchRecentFlows({ since_hours: 0.5, order: "premium" });
    if (!rows.length) return anomalies;

    // Group by ticker
    const byTicker = new Map<string, typeof rows>();
    for (const r of rows) {
      const t = r.ticker ?? "SPX";
      if (!byTicker.has(t)) byTicker.set(t, []);
      byTicker.get(t)!.push(r);
    }

    for (const [ticker, prints] of byTicker) {
      let callPrem = 0;
      let putPrem = 0;
      let maxSingle = 0;
      let maxSingleRow: (typeof rows)[0] | null = null;

      for (const p of prints) {
        const prem = p.premium ?? 0;
        if (p.option_type?.toUpperCase().startsWith("C")) callPrem += prem;
        else putPrem += prem;
        if (prem > maxSingle) {
          maxSingle = prem;
          maxSingleRow = p;
        }
      }

      // Large single print > $2M
      if (maxSingle >= 2_000_000 && maxSingleRow) {
        const dir = maxSingleRow.option_type?.toUpperCase().startsWith("C") ? "bullish" : "bearish";
        anomalies.push({
          type: "LARGE_PREMIUM_PRINT",
          ticker,
          detail: `${ticker}: $${(maxSingle / 1_000_000).toFixed(1)}M single ${maxSingleRow.option_type?.toUpperCase()} print at strike ${maxSingleRow.strike}`,
          premium: maxSingle,
          direction: dir,
          severity: maxSingle >= 5_000_000 ? "CRITICAL" : "HIGH",
        });
      }

      // Extreme call/put skew (10:1 or 1:10)
      const total = callPrem + putPrem;
      if (total >= 500_000) {
        const callRatio = putPrem > 0 ? callPrem / putPrem : callPrem > 0 ? 99 : 0;
        const putRatio = callPrem > 0 ? putPrem / callPrem : putPrem > 0 ? 99 : 0;
        if (callRatio >= 10) {
          anomalies.push({
            type: "DIRECTIONAL_FLOW_SKEW",
            ticker,
            detail: `${ticker}: extreme call skew (${callRatio.toFixed(0)}:1 call/put) — $${(callPrem / 1_000_000).toFixed(1)}M calls vs $${(putPrem / 1_000_000).toFixed(1)}M puts`,
            premium: total,
            direction: "bullish",
            severity: "HIGH",
          });
        } else if (putRatio >= 10) {
          anomalies.push({
            type: "DIRECTIONAL_FLOW_SKEW",
            ticker,
            detail: `${ticker}: extreme put skew (${putRatio.toFixed(0)}:1 put/call) — $${(putPrem / 1_000_000).toFixed(1)}M puts vs $${(callPrem / 1_000_000).toFixed(1)}M calls`,
            premium: total,
            direction: "bearish",
            severity: "HIGH",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[market-regime-detector] anomaly scan failed:", err);
  }
  return anomalies;
}

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

  try {
    const [{ merged }, anomalies] = await Promise.all([
      loadMergedSpxDesk(),
      detectFlowAnomalies(),
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
      }
    }

    const payload = {
      ok: true,
      composite,
      gex_regime,
      vol_regime,
      trend_regime,
      flow_regime,
      anomalies_found: anomalies.length,
      anomalies_inserted: anomaliesInserted,
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
