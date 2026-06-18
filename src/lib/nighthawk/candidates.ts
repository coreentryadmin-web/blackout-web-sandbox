import { INDEX_SET } from "./constants";

function safeFloat(v: unknown): number {
  const n = Number(String(v ?? 0).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function extractCandidateTickers(
  stockFlows: Record<string, unknown>[],
  hotChains: Record<string, unknown>[],
  maxTickers = 20
): string[] {
  const scores = new Map<string, number>();

  for (const r of stockFlows) {
    const ticker = String(r.ticker ?? "").toUpperCase();
    if (!ticker || INDEX_SET.has(ticker)) continue;
    let prem = safeFloat(r.total_premium ?? r.premium);
    let bonus = r.has_sweep ? 1.5 : 1;
    if (r.all_opening_trades) bonus *= 1.3;
    scores.set(ticker, (scores.get(ticker) ?? 0) + prem * bonus);
  }

  for (const r of hotChains) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || INDEX_SET.has(ticker)) continue;
    const prem = safeFloat(r.total_premium ?? r.premium);
    scores.set(ticker, (scores.get(ticker) ?? 0) + prem * 0.5);
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTickers)
    .map(([t]) => t);
}
