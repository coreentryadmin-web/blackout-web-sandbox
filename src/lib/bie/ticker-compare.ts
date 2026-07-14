// Side-by-side ticker comparison — deterministic, no LLM.

// Relative specifier (not "@/lib/bie/…") so ticker-compare.test.ts can intercept it with
// mock.module — the same mockability convention cortex-read.ts documents for its own seams.
import type { EcosystemContext } from "./ecosystem-context";
import { fetchEcosystemContext } from "./ecosystem-context";

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

/** |spot − flip| as a % of spot, from the same gex_positioning the Thermal row cites.
 *  Null when either number is missing — never a fabricated distance. */
function flipProximity(ctx: EcosystemContext): { spot: number; flip: number; pct: number } | null {
  const g = ctx.gex_positioning;
  if (!g || g.flip == null || !(typeof g.spot === "number" && g.spot > 0)) return null;
  return { spot: g.spot, flip: g.flip, pct: (Math.abs(g.spot - g.flip) / g.spot) * 100 };
}

/**
 * Explicit closer-to-flip verdict — the compare answer must NAME BOTH tickers with their flip
 * distances and DECLARE the winner, not leave the member to eyeball two flip strikes on different
 * price scales out of the table (an SPX flip 80 points away can be nearer in % terms than an NVDA
 * flip 8 points away). Live-battery defect (PR-L1): "Is SPX or NVDA closer to its gamma flip?"
 * produced an answer naming only one side. Ties (equal %) go to the first-named ticker. Honest on
 * missing data: one/both flips unknown → says so instead of inventing a winner.
 */
function flipProximityLine(a: EcosystemContext, b: EcosystemContext): string {
  const pa = flipProximity(a);
  const pb = flipProximity(b);
  const leg = (t: string, p: { spot: number; flip: number; pct: number }) =>
    `${t} is ${p.pct.toFixed(2)}% from its flip (spot ${fmt(p.spot, 2)} vs flip ${fmt(p.flip, 2)})`;
  if (pa && pb) {
    const winner = pa.pct <= pb.pct ? a.ticker : b.ticker;
    return `**Closer to its gamma flip: ${winner}** — ${leg(a.ticker, pa)}; ${leg(b.ticker, pb)}.`;
  }
  if (pa || pb) {
    const known = pa ? a.ticker : b.ticker;
    const missing = pa ? b.ticker : a.ticker;
    return `Flip proximity: ${leg(known, (pa ?? pb)!)}; ${missing} has no flip on record right now, so no closer-to-flip call.`;
  }
  return `Flip proximity: no gamma-flip data on record for ${a.ticker} or ${b.ticker} right now.`;
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
    flipProximityLine(a, b),
    "",
    "_Same readers Largo tools use — ask for a single-name verdict or SPX desk read for deeper synthesis._",
  ];

  return { answer: lines.join("\n"), context: { a, b } };
}
