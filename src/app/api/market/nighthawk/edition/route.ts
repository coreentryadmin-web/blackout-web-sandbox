import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  requireDatabaseInProduction,
  fetchLatestNighthawkEdition,
  fetchLatestPlayableNighthawkEdition,
  fetchNighthawkEditionByDate,
} from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { rowToNightHawkEdition } from "@/lib/nighthawk/edition-builder";
import { convictionFromScore } from "@/lib/nighthawk/scorer";
import { isBeforeOrAtMarketCloseEt, nextTradingDayEt, priorEt, todayEt } from "@/lib/nighthawk/session";
import { requireToolApi } from "@/lib/tool-access-server";
import type { NightHawkEdition } from "@/lib/nighthawk/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Airtight no-store across the whole CDN chain (#77). The edition's `available` flag flips the
// user page between the recap and the "awaiting close" pending state, so a stale CDN copy serving
// available:false would re-show "Playbook pending" after a real edition published. `Cache-Control`
// covers browsers + most CDNs; `CDN-Cache-Control` is honored specifically by Cloudflare/Fastly even
// if they were configured to ignore the standard header. A direct no-store fetch already shows the
// fresh value — these headers stop any intermediary from caching the response.
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
} as const;

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
    const data = (await res.json()) as {
      plays?: Array<Record<string, unknown>>;
      generated_at?: unknown;
      as_of?: unknown;
      scanned_at?: unknown;
    };
    const plays = (data.plays ?? []).slice(0, 5).map((p, i) => {
      // Use the engine's real score when present — never fabricate a 0 that reads as a real
      // reading. A missing score becomes undefined so the UI renders "—".
      const score = Number(p.score);
      const realScore = Number.isFinite(score) ? score : undefined;
      return {
        rank: i + 1,
        ticker: String(p.ticker ?? "?").toUpperCase(),
        direction: String(p.direction ?? "LONG"),
        // Derive conviction from the real score instead of hardcoding "B"; leave it blank
        // when there is no score to derive from.
        conviction: realScore != null ? convictionFromScore(realScore) : "",
        play_type: "stock" as const,
        thesis: String(p.summary ?? ""),
        key_signal: String(p.summary ?? ""),
        entry_range: "—",
        target: "—",
        stop: "—",
        options_play: "—",
        score: realScore,
        flow_streak_days: Number(p.streak_days ?? 0) || undefined,
        iv_rank: Number(p.iv_rank ?? 0) || undefined,
      };
    });
    if (!plays.length) return null;
    const editionFor = nextTradingDayEt(todayEt());
    // Carry the engine's real timestamp if it provides one; otherwise null (unknown publish
    // time) — never stamp `now` over possibly-old engine data, which would assert freshness.
    const engineTs = data.generated_at ?? data.as_of ?? data.scanned_at;
    const publishedAt = typeof engineTs === "string" && !Number.isNaN(new Date(engineTs).getTime())
      ? new Date(engineTs).toISOString()
      : null;
    return {
      available: true,
      edition_for: editionFor,
      published_at: publishedAt,
      recap_headline: "Legacy engine plays",
      recap_summary: "Served from BlackOut intel engine fallback — degraded source.",
      market_recap: null,
      plays,
      degraded: true,
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
  const activePlayable = await fetchLatestPlayableNighthawkEdition();

  // A generated playbook remains actionable until its target session closes. If the next evening
  // build has already written a recap-only/pending row, do NOT hide today's live plays before 4PM ET.
  if (
    activePlayable &&
    activePlayable.edition_for !== editionFor &&
    isBeforeOrAtMarketCloseEt(activePlayable.edition_for)
  ) {
    const edition = rowToNightHawkEdition(activePlayable);
    edition.carry_until_close = true;
    edition.served_for = activePlayable.edition_for;
    return NextResponse.json(edition, { headers: NO_STORE_HEADERS });
  }

  // Exact requested edition — fresh for the requested session when it has published.
  const exact = await fetchNighthawkEditionByDate(editionFor);
  if (exact) {
    return NextResponse.json(rowToNightHawkEdition(exact), { headers: NO_STORE_HEADERS });
  }

  // Requested edition isn't published yet. Fall back to the latest stored edition ONLY if it is
  // recent enough to still be actionable — within the recency window (requested session, current,
  // or prior trading day). An older fallback is still served (so the page isn't blank), but flagged
  // `stale: true` so the UI shows "Showing {date} edition — tonight's not published yet" instead of
  // asserting a green "Edition live" over plays whose levels are no longer current (#77 residual).
  const latest = await fetchLatestNighthawkEdition();
  if (latest) {
    const edition = rowToNightHawkEdition(latest);
    const recencyWindow = new Set([editionFor, todayEt(), priorEt()]);
    if (edition.edition_for && !recencyWindow.has(edition.edition_for)) {
      edition.stale = true;
      edition.served_for = edition.edition_for;
    }
    return NextResponse.json(edition, { headers: NO_STORE_HEADERS });
  }

  const legacy = await fetchLegacyPlays();
  if (legacy) {
    return NextResponse.json(legacy, { headers: NO_STORE_HEADERS });
  }

  return NextResponse.json(emptyEdition(editionFor), { headers: NO_STORE_HEADERS });
}
