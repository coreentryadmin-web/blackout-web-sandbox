import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, fetchLatestNighthawkEdition, fetchNighthawkEditionByDate } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { rowToNightHawkEdition } from "@/lib/nighthawk/edition-builder";
import { nextTradingDayEt, todayEt } from "@/lib/nighthawk/session";
import { requireToolApi } from "@/lib/tool-access-server";
import type { NightHawkEdition } from "@/lib/nighthawk/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENGINE_BASE = process.env.BLACKOUT_INTEL_URL?.replace(/\/$/, "") ?? "";

function emptyEdition(editionFor: string): NightHawkEdition {
  return {
    available: false,
    edition_for: editionFor,
    published_at: null,
    recap_headline: null,
    recap_summary: "Tonight's edition publishes after the close. Five ranked plays land here automatically.",
    market_recap: null,
    plays: [],
  };
}

async function fetchLegacyPlays(): Promise<NightHawkEdition | null> {
  if (!ENGINE_BASE) return null;
  try {
    const apiKey = process.env.BLACKOUT_INTEL_API_KEY ?? "";
    const res = await fetch(`${ENGINE_BASE}/api/nighthawk/plays`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { plays?: Array<Record<string, unknown>> };
    const plays = (data.plays ?? []).slice(0, 5).map((p, i) => ({
      rank: i + 1,
      ticker: String(p.ticker ?? "?").toUpperCase(),
      direction: String(p.direction ?? "LONG"),
      conviction: "B",
      play_type: "stock" as const,
      thesis: String(p.summary ?? ""),
      key_signal: String(p.summary ?? ""),
      entry_range: "—",
      target: "—",
      stop: "—",
      options_play: "—",
      score: Number(p.score ?? 0),
      flow_streak_days: Number(p.streak_days ?? 0) || undefined,
      iv_rank: Number(p.iv_rank ?? 0) || undefined,
    }));
    if (!plays.length) return null;
    const editionFor = nextTradingDayEt(todayEt());
    return {
      available: true,
      edition_for: editionFor,
      published_at: new Date().toISOString(),
      recap_headline: "Legacy engine plays",
      recap_summary: "Served from BlackOut intel engine fallback.",
      market_recap: null,
      plays,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const editionFor = req.nextUrl.searchParams.get("date") ?? nextTradingDayEt(todayEt());

  const row = (await fetchNighthawkEditionByDate(editionFor)) ?? (await fetchLatestNighthawkEdition());
  if (row) {
    return NextResponse.json(rowToNightHawkEdition(row), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  }

  const legacy = await fetchLegacyPlays();
  if (legacy) {
    return NextResponse.json(legacy, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(emptyEdition(editionFor), {
    headers: { "Cache-Control": "no-store" },
  });
}
