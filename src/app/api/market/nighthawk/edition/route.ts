import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import type { NightHawkEdition, PlaybookPlay } from "@/lib/nighthawk/types";

export const dynamic = "force-dynamic";

const ENGINE_BASE = process.env.BLACKOUT_INTEL_URL?.replace(/\/$/, "") ?? "";

function nextTradingDayEt(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
  let cursor = new Date(now);
  for (let i = 0; i < 6; i++) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const day = fmt.format(cursor);
    if (day !== "Sat" && day !== "Sun") {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(cursor);
    }
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function mapLegacyPlay(play: Record<string, unknown>, rank: number): PlaybookPlay {
  return {
    rank,
    ticker: String(play.ticker ?? "?").toUpperCase(),
    direction: String(play.direction ?? "LONG"),
    conviction: String(play.conviction ?? "B"),
    play_type: "stock",
    thesis: String(play.summary ?? play.swing_thesis ?? play.key_signal ?? ""),
    key_signal: String(play.key_signal ?? ""),
    entry_range: String(play.entry_range ?? play.entry_condition ?? "—"),
    target: String(play.target ?? "—"),
    stop: String(play.stop ?? "—"),
    options_play: String(play.contract ?? play.options_play ?? "—"),
    score: Number(play.score ?? 0),
    flow_streak_days: Number(play.streak_days ?? play.flow_streak_days ?? 0) || undefined,
    iv_rank: Number(play.iv_rank ?? 0) || undefined,
  };
}

async function fetchLegacyPlays(): Promise<PlaybookPlay[]> {
  if (!ENGINE_BASE) return [];
  try {
    const res = await fetch(`${ENGINE_BASE}/api/nighthawk/plays`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { plays?: Record<string, unknown>[] };
    return (data.plays ?? []).slice(0, 5).map((p, i) => mapLegacyPlay(p, i + 1));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const legacyPlays = await fetchLegacyPlays();
  const editionFor = nextTradingDayEt();

  const edition: NightHawkEdition = {
    available: legacyPlays.length > 0,
    edition_for: editionFor,
    published_at: legacyPlays.length > 0 ? new Date().toISOString() : null,
    recap_headline:
      legacyPlays.length > 0 ? "Evening playbook · top setups for next session" : null,
    recap_summary:
      legacyPlays.length > 0
        ? "Curated from today’s flow, technicals, catalysts, and sector rotation."
        : "Tonight’s edition publishes after the close. Five ranked plays land here automatically.",
    plays: legacyPlays,
  };

  return NextResponse.json(edition, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}
