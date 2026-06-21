import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import { serverCache } from "@/lib/server-cache";
import type { FlowAlert } from "@/lib/api";

export const dynamic = "force-dynamic";

const BRIEF_TTL_MS = 2 * 60 * 1000; // 2 minutes

function buildPrompt(alerts: FlowAlert[]): string {
  if (!alerts.length) return "";

  const callPrem = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
  const putPrem  = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);
  const total = callPrem + putPrem;
  const callPct = total > 0 ? Math.round((callPrem / total) * 100) : 50;
  const whalePrints = alerts.filter((a) => a.premium >= 1_000_000).length;

  const topAlerts = alerts.slice(0, 12).map((a) =>
    `${a.ticker} ${a.option_type} $${a.strike} ${a.expiry} ${a.route} $${(a.premium / 1000).toFixed(0)}K score:${a.score}`
  ).join("\n");

  return `You are a real-time options flow analyst. Summarize the current market flow tape in exactly 2 short sentences (max 180 chars total). Be direct, data-driven, no fluff. Write like a trading desk memo.

Flow stats:
- ${alerts.length} alerts in tape · ${callPct}% call premium · ${100 - callPct}% put premium
- Call premium: $${(callPrem / 1e6).toFixed(2)}M · Put premium: $${(putPrem / 1e6).toFixed(2)}M
- Whale prints (>$1M): ${whalePrints}

Recent alerts:
${topAlerts}

Write 2 sentences max. Example format: "SPY and QQQ seeing concentrated call sweeps at 68% call premium. Floor prints on SPX suggest institutional positioning into close." Do NOT say "the tape shows" or start with "I".`;
}

export async function POST(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!anthropicConfigured()) {
    return NextResponse.json({ brief: null, reason: "ANTHROPIC_API_KEY not set" }, { status: 200 });
  }

  let alerts: FlowAlert[] = [];
  try {
    const body = await req.json();
    alerts = Array.isArray(body?.alerts) ? body.alerts.slice(0, 50) : []; // Bug 17: cap input size
  } catch {
    return NextResponse.json({ brief: null }, { status: 400 });
  }

  if (alerts.length === 0) {
    return NextResponse.json({ brief: null }, { status: 200 });
  }

  // Cache key based on top-5 alert fingerprint so identical tapes return instantly
  const cacheKey = `flow-brief:${alerts.slice(0, 5).map((a) => `${a.ticker}${a.alerted_at}`).join("|")}`;

  try {
    const brief = await serverCache(cacheKey, BRIEF_TTL_MS, () =>
      anthropicText(buildPrompt(alerts), 120, "You are a terse trading desk analyst. Two sentences only.")
    );
    return NextResponse.json({ brief: brief?.trim() ?? null });
  } catch (err) {
    console.error("[flow-brief]", err);
    // Bug 7: return 503 so clients can distinguish transient error from "no brief yet"
    return NextResponse.json({ brief: null, error: "api_error" }, { status: 503 });
  }
}
