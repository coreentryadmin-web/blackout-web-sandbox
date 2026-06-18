import { fetchRecentFlows } from "@/lib/db";
import { subscribeFlowEvents, publishFlowEvent } from "@/lib/flow-events";
import {
  computeFlowStrikeStacks,
  withStrikeStacks,
  type FlowStrikeStack,
} from "@/lib/largo/flow-strike-stacks";
import type { FlowTapeSummary } from "./types";

export { subscribeFlowEvents, publishFlowEvent };

export async function getFlowTape(opts?: { ticker?: string; limit?: number }) {
  return fetchRecentFlows({
    limit: opts?.limit ?? 25,
    ticker: opts?.ticker ? opts.ticker.toUpperCase() : undefined,
  });
}

export function getFlowStrikeStacks(
  alerts: Parameters<typeof computeFlowStrikeStacks>[0]
): FlowStrikeStack[] {
  return computeFlowStrikeStacks(alerts);
}

export async function getFlowTapeWithStacks(opts?: { ticker?: string; limit?: number }) {
  const rows = await getFlowTape(opts);
  return {
    rows,
    strike_stacks: computeFlowStrikeStacks(rows),
  };
}

export async function getFlowTapeSummary(opts?: { ticker?: string; limit?: number }): Promise<FlowTapeSummary> {
  const rows = await getFlowTape(opts);
  const byTicker = new Map<string, { premium: number; count: number }>();

  for (const row of rows) {
    const cur = byTicker.get(row.ticker) ?? { premium: 0, count: 0 };
    cur.premium += row.premium;
    cur.count += 1;
    byTicker.set(row.ticker, cur);
  }

  const top_tickers = Array.from(byTicker.entries())
    .map(([ticker, v]) => ({ ticker, premium: v.premium, count: v.count }))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 10);

  return {
    count: rows.length,
    total_premium: rows.reduce((s, r) => s + r.premium, 0),
    top_tickers,
    recent: rows,
  };
}
