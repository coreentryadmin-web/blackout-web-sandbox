// Side-by-side ticker comparison — deterministic, no LLM.

import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import { fetchEcosystemContext } from "@/lib/bie/ecosystem-context";

const fmt = (n: number | null | undefined, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

function flowLine(ctx: EcosystemContext): string {
  const f = ctx.recent_flow;
  if (!f || f.print_count === 0) return "flow quiet";
  const total = f.call_premium + f.put_premium;
  const callPct = total > 0 ? Math.round((f.call_premium / total) * 100) : 50;
  return `${f.print_count} prints · ${callPct}% call · $${fmt(total, 0)}`;
}

function nhLine(ctx: EcosystemContext): string {
  const n = ctx.nighthawk_recent;
  if (!n) return "NH —";
  return `NH ${n.direction} ${n.conviction}${n.score != null ? ` (${fmt(n.score)})` : ""}`;
}

function gexLine(ctx: EcosystemContext): string {
  const g = ctx.gex_positioning;
  if (!g) return "GEX —";
  return `γ ${g.gamma_posture ?? "—"} · flip ${fmt(g.flip, 0)}`;
}

function zerodteLine(ctx: EcosystemContext): string {
  const z = ctx.zerodte_today;
  if (!z) return "0DTE —";
  return `0DTE ${z.direction} score ${fmt(z.score)}`;
}

export async function composeTickerCompare(tickerA: string, tickerB: string): Promise<{
  answer: string;
  context: { a: EcosystemContext; b: EcosystemContext };
}> {
  const [a, b] = await Promise.all([
    fetchEcosystemContext(tickerA),
    fetchEcosystemContext(tickerB),
  ]);

  const lines = [
    `**${a.ticker} vs ${b.ticker} — cross-instrument compare**`,
    "",
    `| Signal | ${a.ticker} | ${b.ticker} |`,
    `|--------|${"—".repeat(a.ticker.length + 2)}|${"—".repeat(b.ticker.length + 2)}|`,
    `| Night Hawk | ${nhLine(a)} | ${nhLine(b)} |`,
    `| 0DTE today | ${zerodteLine(a)} | ${zerodteLine(b)} |`,
    `| HELIX (6h) | ${flowLine(a)} | ${flowLine(b)} |`,
    `| Thermal GEX | ${gexLine(a)} | ${gexLine(b)} |`,
    `| Anomalies | ${a.recent_anomalies.length ? a.recent_anomalies[0]!.anomaly_type : "—"} | ${b.recent_anomalies.length ? b.recent_anomalies[0]!.anomaly_type : "—"} |`,
    "",
    "_Same readers Largo tools use — ask for a single-name verdict or SPX desk read for deeper synthesis._",
  ];

  return { answer: lines.join("\n"), context: { a, b } };
}
