import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { buildCoachingAlerts } from "@/features/vector/lib/vector-coaching";
import { isEtCashRth } from "@/lib/et-market-hours";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("coaching-alerts", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const { alerts, spxPrice, callWall, putWall, vwap } = await buildCoachingAlerts();
    if (!alerts.length) {
      const payload = { ok: true, written: 0, reason: "No coaching triggers" };
      await logCronRun("coaching-alerts", started, payload);
      return NextResponse.json(payload);
    }

    await Promise.all(
      alerts.map((a) =>
        dbQuery(
          `INSERT INTO coaching_alerts (trigger_type, alert_text, urgency, spx_price, call_wall, put_wall, vwap, for_longs, for_shorts, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            a.trigger,
            a.alert,
            a.urgency,
            spxPrice,
            callWall,
            putWall,
            vwap,
            a.for_longs ?? true,
            a.for_shorts ?? false,
            JSON.stringify(a),
          ]
        )
      )
    );

    const payload = { ok: true, written: alerts.length };
    await logCronRun("coaching-alerts", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await logCronRun("coaching-alerts", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "coaching-alerts failed" }, { status: 500 });
  }
}
