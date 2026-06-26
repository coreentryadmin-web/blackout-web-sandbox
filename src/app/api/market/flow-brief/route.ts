import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import { serverCache, TTL } from "@/lib/server-cache";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchMarketFlowAlerts, fetchUwDarkPoolRecent } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import type { FlowAlert } from "@/lib/api";

export const dynamic = "force-dynamic";

// One shared brief per 15-minute window — same response for every user.
// First request in the window triggers Claude; all others get the cached result instantly.
const BRIEF_TTL_MS    = 15 * 60 * 1000;
const MASSIVE_FLOW    = 15_000_000;   // $15M+ options flow
const MASSIVE_BLOCK   = 15_000_000;   // $15M+ dark pool block

// ─── Inline normalization (mirrors dark-pool/route.ts) ────────────────────────
interface NormalizedBlock {
  ticker: string;
  premium: number;
  side: string;
  share_size?: number;
}

function normalizeDark(raw: unknown): NormalizedBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ticker = String(r.ticker ?? r.symbol ?? r.underlying ?? "").toUpperCase();
  const premium = Number(r.premium ?? r.notional ?? r.size_premium ?? 0);
  if (!ticker || premium <= 0) return null;
  const sideRaw = String(r.side ?? r.sentiment ?? r.direction ?? "neutral").toLowerCase();
  const side = sideRaw.includes("buy") ? "buy" : sideRaw.includes("sell") ? "sell" : "neutral";
  const share_size = r.size != null ? Number(r.size) : undefined;
  return { ticker, premium, side, share_size };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
function buildPrompt(alerts: FlowAlert[], darkPrints: NormalizedBlock[]): string {
  if (!alerts.length) return "";

  const callPrem    = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
  const putPrem     = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);
  const total       = callPrem + putPrem;
  const callPct     = total > 0 ? Math.round((callPrem / total) * 100) : 50;
  const whalePrints = alerts.filter((a) => a.premium >= 1_000_000).length;

  // Highlight massive options flow ($15M+) — most notable signals
  const massiveFlows = alerts
    .filter((a) => a.premium >= MASSIVE_FLOW)
    .slice(0, 5)
    .map((a) =>
      `${a.ticker} ${a.option_type} $${a.strike} exp:${a.expiry} ${a.route} $${(a.premium / 1e6).toFixed(1)}M`
    );

  // Highlight massive dark pool blocks ($15M+) — institutional block trades
  const massiveBlocks = darkPrints
    .filter((d) => d.premium >= MASSIVE_BLOCK)
    .slice(0, 4)
    .map((d) =>
      `${d.ticker} ${d.side.toUpperCase()} $${(d.premium / 1e6).toFixed(1)}M block${d.share_size ? ` (${(d.share_size / 1000).toFixed(0)}K shares)` : ""}`
    );

  // Top flow alerts for context
  const topAlerts = alerts
    .slice(0, 10)
    .map((a) =>
      `${a.ticker} ${a.option_type} $${a.strike} ${a.expiry} ${a.route} $${(a.premium / 1000).toFixed(0)}K score:${a.score}`
    )
    .join("\n");

  let prompt = `You are a real-time options flow analyst. Summarize the current market flow tape in 2-3 short sentences (max 240 chars total). Be direct, data-driven, no fluff. Write like a trading desk memo.

Flow stats:
- ${alerts.length} alerts · ${callPct}% call premium · ${100 - callPct}% put premium
- Total: $${(total / 1e6).toFixed(1)}M · Call: $${(callPrem / 1e6).toFixed(1)}M · Put: $${(putPrem / 1e6).toFixed(1)}M
- Whale prints (>$1M): ${whalePrints}`;

  if (massiveFlows.length > 0) {
    prompt += `\n\n🔥 MASSIVE options flow ($15M+) — mention these:\n${massiveFlows.join("\n")}`;
  }

  if (massiveBlocks.length > 0) {
    prompt += `\n\n🏦 MASSIVE dark pool blocks ($15M+) — mention these:\n${massiveBlocks.join("\n")}`;
  }

  prompt += `\n\nRecent top alerts:\n${topAlerts}`;

  prompt += `\n\nRules: 2-3 sentences max. If there are massive blocks or sweeps ($15M+), lead with or explicitly name them. Example: "Institutional $23M AAPL dark pool BUY and $18M SPX call sweep signal bull positioning. Call bias at 68% with whale concentration in mega-caps ahead of close." Do NOT say "the tape shows" or start with "I".`;

  return prompt;
}

// ─── Shared data fetcher (reuses the same serverCache keys as other routes) ───
async function fetchSharedData(): Promise<{ alerts: FlowAlert[]; darkPrints: NormalizedBlock[] }> {
  // Fetch flows using a brief-owned cache key — avoids colliding with the flows route
  // which stores a different shape ({ source, flows, count, platform_refs }) under its keys.
  let alerts: FlowAlert[] = [];
  try {
    if (dbConfigured()) {
      alerts = await serverCache(
        "flow-brief:flows:pg:168:200000",
        TTL.DARK_POOL,
        () => fetchRecentFlows({ limit: 500, min_premium: 200_000, since_hours: 168 })
      ) as FlowAlert[];
    } else if (uwConfigured()) {
      alerts = await serverCache(
        "flow-brief:flows:uw:200:200000",
        TTL.DARK_POOL,
        () => fetchMarketFlowAlerts({ limit: 200, min_premium: 200_000 })
      ) as FlowAlert[];
    }
  } catch (err) {
    console.error("[flow-brief] flows fetch error:", err);
  }

  // Fetch dark pool prints — uses the same cache key as /api/market/dark-pool
  let darkPrints: NormalizedBlock[] = [];
  if (uwConfigured()) {
    try {
      const rawRows = await serverCache("dark-pool:recent:50", TTL.DARK_POOL, () =>
        fetchUwDarkPoolRecent(50)
      );
      darkPrints = (Array.isArray(rawRows) ? rawRows : [])
        .map(normalizeDark)
        .filter((r): r is NormalizedBlock => r !== null)
        .sort((a, b) => b.premium - a.premium);
    } catch (err) {
      console.error("[flow-brief] dark-pool fetch error:", err);
    }
  }

  return { alerts, darkPrints };
}

// ─── GET — shared endpoint, one Claude call per 15-min window ─────────────────
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!anthropicConfigured()) {
    return NextResponse.json({ brief: null, reason: "ANTHROPIC_API_KEY not set" });
  }

  // Time-window cache key — same for every user in the same 15-min slot
  const windowSlot = Math.floor(Date.now() / BRIEF_TTL_MS);
  const cacheKey   = `flow-brief:shared:v3:${windowSlot}`;

  try {
    const result = await serverCache(cacheKey, BRIEF_TTL_MS, async () => {
      const { alerts, darkPrints } = await fetchSharedData();
      const prompt = buildPrompt(alerts, darkPrints);
      if (!prompt) return null;

      const massiveCount = alerts.filter((a) => a.premium >= MASSIVE_FLOW).length +
                           darkPrints.filter((d) => d.premium >= MASSIVE_BLOCK).length;

      const brief = await anthropicText(
        prompt,
        180,
        "You are a terse trading desk analyst. 2-3 sentences only. Highlight $15M+ signals by ticker name.",
        { maxRetries: 1 }
      );

      return { brief: brief?.trim() ?? null, massive_signals: massiveCount };
    });

    return NextResponse.json({
      brief: result?.brief ?? null,
      massive_signals: result?.massive_signals ?? 0,
      window_slot: windowSlot,
      next_refresh_ms: BRIEF_TTL_MS - (Date.now() % BRIEF_TTL_MS),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[flow-brief]", err);
    return NextResponse.json({ brief: null, error: "api_error" }, { status: 503 });
  }
}
