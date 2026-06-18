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
} from "@/lib/nighthawk/play-explainer";
import type { PlaybookPlay, PlayExplainRequest, PlayExplainResponse } from "@/lib/nighthawk/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

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
  const play = plays.find((p) => p.ticker.toUpperCase() === ticker);
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

  const dossierContextMap = (meta.dossier_context ?? {}) as Record<string, string>;
  const dossierContext = await resolveDossierContext(ticker, dossierContextMap[ticker]);

  const explanation = await generatePlayExplanation({
    play,
    editionFor: row.edition_for,
    recapHeadline: row.recap_headline,
    recapSummary: row.recap_summary,
    marketRecap: row.market_recap,
    dossierContext,
  });

  if (!explanation?.trim()) {
    return NextResponse.json({ error: "Failed to generate explanation" }, { status: 502 });
  }

  void cacheNighthawkPlayExplanation(row.edition_for, ticker, explanation).catch((err) => {
    console.error("[nighthawk/play-explain] cache failed:", err);
  });

  const response: PlayExplainResponse = {
    ticker,
    rank: play.rank,
    explanation,
    cached: false,
  };

  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
