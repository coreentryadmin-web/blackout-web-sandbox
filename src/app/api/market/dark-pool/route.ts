import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { serverCache, TTL } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

export interface DarkPoolRow {
  ticker: string;
  premium: number;
  side: string;
  executed_at: string;
  share_size?: number;
}

function normalizeRow(raw: unknown): DarkPoolRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const ticker = String(r.ticker ?? r.symbol ?? r.underlying ?? "").toUpperCase();
  if (!ticker) return null;

  const premium = Number(r.premium ?? r.notional ?? r.size_premium ?? 0);
  if (premium <= 0) return null;

  const sideRaw = String(r.side ?? r.sentiment ?? r.direction ?? "neutral").toLowerCase();
  const side = sideRaw.includes("buy") ? "buy" : sideRaw.includes("sell") ? "sell" : "neutral";

  const executed_at = String(r.executed_at ?? r.date ?? r.timestamp ?? new Date().toISOString());
  const share_size = r.size != null ? Number(r.size) : undefined;

  return { ticker, premium, side, executed_at, share_size };
}

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 50), 100);
  const min_premium = Number(sp.get("min_premium") ?? 0) || 0;

  try {
    const rawRows = await serverCache(`dark-pool:recent:${limit}`, TTL.DARK_POOL, async () => {
      const { fetchUwDarkPoolRecent } = await import("@/lib/providers/unusual-whales");
      return fetchUwDarkPoolRecent(limit);
    });

    const prints = (Array.isArray(rawRows) ? rawRows : [])
      .map(normalizeRow)
      .filter((r): r is DarkPoolRow => r !== null)
      .filter((r) => r.premium >= min_premium)
      .sort((a, b) => b.premium - a.premium);

    return NextResponse.json({ prints, count: prints.length });
  } catch (err) {
    console.error("[dark-pool]", err);
    return NextResponse.json({ prints: [], count: 0 }, { status: 200 });
  }
}
