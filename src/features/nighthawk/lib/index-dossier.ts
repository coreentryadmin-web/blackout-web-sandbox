import { INDEX_ETF_PLAYS } from "./constants";
import type { MarketWideContext } from "./market-wide";
import { fetchPositioningSummary } from "./positioning";
import { buildTechnicalCard } from "./technicals";

export type IndexDossier = {
  ticker: string;
  call_premium: number;
  put_premium: number;
  total_premium: number;
  flow_bias: string;
  tech_summary: string | null;
  positioning_summary: string | null;
};

function flowBias(call: number, put: number): string {
  const total = call + put;
  if (total <= 0) return "MIXED";
  const callPct = (call / total) * 100;
  if (callPct > 58) return "CALLS";
  if (callPct < 42) return "PUTS";
  return "MIXED";
}

export async function fetchIndexDossiers(
  ctx: MarketWideContext,
  minPremium = 100_000
): Promise<IndexDossier[]> {
  const out: IndexDossier[] = [];

  for (const ticker of INDEX_ETF_PLAYS) {
    const flow = ctx.index_flows[ticker] as
      | { call_premium?: number; put_premium?: number; total_premium?: number }
      | undefined;
    const call = Number(flow?.call_premium ?? 0);
    const put = Number(flow?.put_premium ?? 0);
    const total = Number(flow?.total_premium ?? call + put);
    if (total < minPremium) continue;

    const [tech, pos] = await Promise.all([
      buildTechnicalCard(ticker).catch(() => null),
      fetchPositioningSummary(ticker).catch(() => null),
    ]);

    out.push({
      ticker,
      call_premium: call,
      put_premium: put,
      total_premium: total,
      flow_bias: flowBias(call, put),
      tech_summary: tech?.summary ?? null,
      positioning_summary: pos
        ? `GEX king $${pos.gex_king_strike ?? "?"} · ${pos.gamma_regime} · max pain $${pos.max_pain ?? "?"}`
        : null,
    });
  }

  return out;
}

export function formatIndexDossierBlock(
  dossiers: IndexDossier[],
  chainTables: Record<string, string> = {}
): string {
  if (!dossiers.length) return "No index/ETF met $100K+ flow threshold.";
  return dossiers
    .map((d) => {
      const chain = chainTables[d.ticker];
      const lines = [
        chain,
        `=== ${d.ticker} (INDEX/ETF) ===`,
        `Flow: calls $${Math.round(d.call_premium / 1000)}K / puts $${Math.round(d.put_premium / 1000)}K → ${d.flow_bias}`,
      ].filter(Boolean) as string[];
      if (d.tech_summary) lines.push(`Technicals: ${d.tech_summary}`);
      if (d.positioning_summary) lines.push(`Positioning: ${d.positioning_summary}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
