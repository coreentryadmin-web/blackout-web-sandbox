import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  cacheNighthawkPlayExplanation,
  fetchLatestNighthawkEdition,
  fetchNighthawkEditionByDate,
  requireDatabaseInProduction,
} from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import {
  generatePlayExplanation,
  resolveDossierContext,
} from "@/features/nighthawk/lib/play-explainer";
import type { PlaybookPlay, PlayExplainRequest, PlayExplainResponse } from "@/features/nighthawk/lib/types";
import { withServerCache } from "@/lib/server-cache";
import { requireToolApi } from "@/lib/tool-access-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Edition play explanations are IDENTICAL for every user on a given trading day, so a cold
 * edition must collapse to ONE Sonnet call cluster-wide — not N (the thundering-herd / launch
 * Anthropic-rate landmine). The DB cache (meta.play_explanations) is the durable cross-day store,
 * but it is only written AFTER generation completes, so it does NOT dedup the concurrent cold
 * burst — N users all read it empty at once and all fire their own ~3,200-token call.
 *
 * withServerCache closes that window: its in-flight single-flight makes concurrent cold requests
 * share ONE generation, and its Redis L1/L2 layer serves every subsequent user (this replica and
 * others) from cache = 0 LLM calls. TTL is held through the trading day; the key is namespaced by
 * editionFor + ticker so it self-rolls when a new edition publishes.
 */
const PLAY_EXPLAIN_TTL_MS = 18 * 60 * 60 * 1000; // 18h — well past one trading session

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeCronOrTierApi(req, "premium");
    if (authResult instanceof Response) return authResult;

    // Launch gate — locked to non-admins until this tool ships.
    const locked = await requireToolApi("nighthawk");
    if (locked) return locked;

    const dbDenied = requireDatabaseInProduction();
    if (dbDenied) return dbDenied;

    let body: PlayExplainRequest;
    try {
      body = (await req.json()) as PlayExplainRequest;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const editionFor = String(body.edition_for ?? "").trim();
    const ticker = String(body.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!editionFor || !ticker) {
      return NextResponse.json({ error: "edition_for and ticker required" }, { status: 400 });
    }

    const row =
      (await fetchNighthawkEditionByDate(editionFor)) ?? (await fetchLatestNighthawkEdition());
    if (!row) {
      return NextResponse.json({ error: "Edition not found" }, { status: 404 });
    }

    const plays = (row.plays as PlaybookPlay[]) ?? [];
    const play = plays.find((p) => p.ticker?.toUpperCase() === ticker);
    if (!play) {
      return NextResponse.json({ error: "Play not in this edition" }, { status: 404 });
    }

    const meta = row.meta ?? {};
    const explanations = (meta.play_explanations ?? {}) as Record<string, string>;
    const cachedExplanation = explanations[ticker];
    if (cachedExplanation?.trim()) {
      const response: PlayExplainResponse = {
        ticker,
        rank: play.rank,
        explanation: cachedExplanation,
        cached: true,
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    // CACHE-READER / single-flight: on a COLD edition, N concurrent users would each fire their
    // own ~3,200-token Sonnet call (the DB cache is written only after generation, so it cannot
    // dedup the concurrent burst). withServerCache collapses them to ONE generation via in-flight
    // single-flight, then serves all subsequent users — this replica and others, through the
    // trading day — from its Redis layer = 0 further LLM calls. The durable DB write is performed
    // once, inside the loader, so the cron/preview path and next-day reads still find it.
    let explanation: string;
    try {
      explanation = await withServerCache(
        `nighthawk:play-explain:${row.edition_for}:${ticker}`,
        PLAY_EXPLAIN_TTL_MS,
        async () => {
          const dossierContextMap = (meta.dossier_context ?? {}) as Record<string, string>;
          const dossierContext = await resolveDossierContext(ticker, dossierContextMap[ticker]);

          const generated = await generatePlayExplanation({
            play,
            editionFor: row.edition_for,
            recapHeadline: row.recap_headline,
            recapSummary: row.recap_summary,
            marketRecap: row.market_recap,
            dossierContext,
          });

          // Throw so server-cache does NOT cache an empty/failed result (it only stores on
          // success) — a transient Anthropic failure must not be pinned for the whole TTL.
          if (!generated?.trim()) {
            throw new Error("empty-explanation");
          }

          // Durable cross-day store. Fire-and-forget: the DB write must not gate the response,
          // and a failed write simply means the next cold request regenerates.
          void cacheNighthawkPlayExplanation(row.edition_for, ticker, generated).catch((err) => {
            console.error("[nighthawk/play-explain] cache failed:", err);
          });

          return generated;
        }
      );
    } catch {
      return NextResponse.json({ error: "Failed to generate explanation" }, { status: 502 });
    }

    const response: PlayExplainResponse = {
      ticker,
      rank: play.rank,
      explanation,
      cached: false,
    };

    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[nighthawk/play-explain]", error);
    return NextResponse.json({ error: "Play explanation failed" }, { status: 502 });
  }
}
