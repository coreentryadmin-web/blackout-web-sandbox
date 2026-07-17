/**
 * Signal Observer cron — runs every 5 minutes during RTH (EventBridge schedule).
 * Captures a complete snapshot of all confluence signals at the current moment:
 * factor weights, raw market values, engine action, session window.
 * Also fills in 30-minute outcomes for earlier observations (did SPX move in
 * the predicted direction?) so we can measure per-signal predictive accuracy.
 *
 * Zero side effects on the play engine — computeSpxConfluence is purely functional.
 * EventBridge rule: EventBridge rule (blackout-infra/cron-jobs.json)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import { etMinutes, etClock } from "@/features/spx/lib/spx-play-session-time";
import {
  initSpxSignalTables,
  insertObservation,
  getPendingOutcomes,
  updateOutcome,
} from "@/features/spx/lib/spx-signal-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function sessionWindow(now = new Date()): string {
  const m = etMinutes(now);
  if (m >= etClock(9, 50)  && m < etClock(11, 30)) return "morning_orb";
  if (m >= etClock(11, 30) && m < etClock(13, 0))  return "lunch_chop";
  if (m >= etClock(13, 0)  && m < etClock(15, 0))  return "afternoon";
  if (m >= etClock(15, 0)  && m < etClock(15, 30)) return "power_hour";
  return "other";
}

let tablesReady = false;

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isSpxEngineCronWindow()) {
    const payload = { ok: true, skipped: true, reason: "Outside RTH cron window" };
    await logCronRun("spx-signal-observe", started, payload);
    return NextResponse.json(payload);
  }

  if (!tablesReady) {
    await initSpxSignalTables();
    tablesReady = true;
  }

  let observed = false;
  let outcomesUpdated = 0;
  let score = 0;
  let grade = "D";
  let action = "WAIT";

  try {
    const { merged } = await loadMergedSpxDesk();
    const confluence = computeSpxConfluence(merged);

    if (confluence && merged.price > 0) {
      score = confluence.score;
      grade = confluence.grade;
      action = confluence.action;

      const direction: "long" | "short" | null =
        score > 0 ? "long" : score < 0 ? "short" : null;

      const vwap = merged.vwap ?? null;
      const price = merged.price;

      // Snapshot raw market values — these are the independent variables we'll
      // correlate against outcomes to measure each signal's true predictive power.
      const raw_json: Record<string, unknown> = {
        tick: merged.tick ?? null,
        trin: merged.trin ?? null,
        add: merged.add ?? null,
        flow_0dte_net: merged.flow_0dte_net ?? null,
        tide_bias: merged.tide_bias ?? null,
        dark_pool_bias: merged.dark_pool?.bias ?? null,
        nope: merged.nope ?? null,
        vix: merged.vix ?? null,
        vix_9d: merged.vix_term?.vix9d ?? null,
        vix_3m: merged.vix_term?.vix3m ?? null,
        ema20: merged.ema20 ?? null,
        gamma_flip: merged.gamma_flip ?? null,
        price_vs_gamma_flip: merged.gamma_flip != null ? price - merged.gamma_flip : null,
        helix_call_prem: null as number | null,
        helix_put_prem: null as number | null,
        helix_ratio: null as number | null,
      };

      // Extract HELIX premiums from today's sweeps (same logic as scoreHelixFlowAlignment)
      if (merged.spx_flows?.length) {
        const nowMs = Date.now();
        const thirtyMinMs = 30 * 60 * 1000;
        const todayYmd = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
        }).format(new Date(nowMs));
        let callPrem = 0;
        let putPrem = 0;
        for (const f of merged.spx_flows) {
          const ticker = (f.ticker ?? "").toUpperCase();
          if (ticker !== "SPX" && ticker !== "SPXW" && ticker !== "SPY") continue;
          if (!f.has_sweep || f.expiry !== todayYmd) continue;
          const alertedAt = f.alerted_at ? new Date(f.alerted_at).getTime() : 0;
          if (!alertedAt || nowMs - alertedAt > thirtyMinMs) continue;
          const t = (f.option_type ?? "").toUpperCase();
          if (t.startsWith("C")) callPrem += f.premium;
          else if (t.startsWith("P")) putPrem += f.premium;
        }
        raw_json.helix_call_prem = callPrem;
        raw_json.helix_put_prem = putPrem;
        raw_json.helix_ratio =
          callPrem > 0 || putPrem > 0
            ? callPrem > putPrem
              ? callPrem / Math.max(putPrem, 1)
              : -(putPrem / Math.max(callPrem, 1))
            : null;
      }

      await insertObservation({
        price,
        vwap,
        price_vs_vwap: vwap != null ? price - vwap : null,
        score,
        grade,
        direction,
        engine_action: action,
        session_window: sessionWindow(),
        vix: merged.vix ?? null,
        market_open: merged.market_open ?? false,
        factors_json: confluence.factors,
        raw_json,
        gates_blocked_json: [], // gate blocks are in spx-evaluate cron_job_runs
      });

      observed = true;

      // Fill outcomes for observations from 28–35 minutes ago using current price as ground truth.
      const pending = await getPendingOutcomes(Date.now());
      for (const row of pending) {
        await updateOutcome(row.id, price);
        outcomesUpdated++;
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[spx-signal-observe]", detail);
    await logCronRun("spx-signal-observe", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }

  const payload = { ok: true, observed, outcomes_updated: outcomesUpdated, score, grade, action };
  await logCronRun("spx-signal-observe", started, payload);
  return NextResponse.json(payload);
}
