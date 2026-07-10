// Narrative formatter for ecosystem context — prose synthesis from structured data.

import type { EcosystemContext } from "@/lib/bie/ecosystem-context";

const fmt = (n: number | null | undefined, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

export function formatEcosystemNarrative(ctx: EcosystemContext): string {
  const t = ctx.ticker;
  const lead: string[] = [];
  const conflict: string[] = [];
  const watch: string[] = [];

  if (ctx.nighthawk_recent) {
    const n = ctx.nighthawk_recent;
    lead.push(
      `Night Hawk has ${t} **${n.direction.toUpperCase()}** (${n.conviction} conviction${n.score != null ? `, score ${fmt(n.score)}` : ""})`
    );
  }
  if (ctx.zerodte_today) {
    const z = ctx.zerodte_today;
    lead.push(
      `0DTE Command flagged **${z.direction.toUpperCase()}** today (score ${fmt(z.score)}${z.status ? `, ${z.status}` : ""})`
    );
  }
  if (ctx.recent_flow) {
    const f = ctx.recent_flow;
    const total = f.call_premium + f.put_premium;
    const callPct = total > 0 ? Math.round((f.call_premium / total) * 100) : 50;
    lead.push(
      `HELIX shows ${f.print_count} prints in ${f.window_hours}h — ${callPct}% call premium ($${fmt(total, 0)} notional)`
    );
  }
  if (ctx.gex_positioning?.gamma_posture) {
    const g = ctx.gex_positioning;
    lead.push(
      `dealers **${g.gamma_posture} gamma**${g.flip != null ? ` with flip at ${fmt(g.flip, 0)}` : ""}`
    );
  }

  if (!lead.length) {
    if (!ctx.flow_feed_fresh) {
      return `**${t}** — flow pipeline is not confirming fresh frames right now; treat as **unknown**, not quiet. Check back after tape refreshes.`;
    }
    return `**${t}** — nothing notable on the cross-instrument desk right now (no NH take, no 0DTE flag, no unusual flow in window).`;
  }

  const nhBull = ctx.nighthawk_recent && /long|bull/i.test(ctx.nighthawk_recent.direction);
  const flowPut =
    ctx.recent_flow &&
    ctx.recent_flow.put_premium > ctx.recent_flow.call_premium * 1.2;
  const flowCall =
    ctx.recent_flow &&
    ctx.recent_flow.call_premium > ctx.recent_flow.put_premium * 1.2;
  if (nhBull && flowPut) conflict.push("put-led HELIX flow vs bullish Night Hawk");
  if (ctx.nighthawk_recent && /short|bear/i.test(ctx.nighthawk_recent.direction) && flowCall) {
    conflict.push("call-led flow vs bearish NH");
  }
  if (ctx.recent_anomalies.length) {
    watch.push(
      ctx.recent_anomalies
        .slice(0, 2)
        .map((a) => `${a.anomaly_type} (${a.severity})`)
        .join(", ")
    );
  }
  if (ctx.gex_positioning?.nearest_wall?.strike) {
    watch.push(`nearest wall ${fmt(ctx.gex_positioning.nearest_wall.strike, 0)}`);
  }

  const parts = [
    `**${t} — cross-instrument read**`,
    "",
    lead.join(". ") + ".",
  ];
  if (conflict.length) parts.push("", `**Friction:** ${conflict.join(" · ")}.`);
  if (watch.length) parts.push("", `**Watch:** ${watch.join(" · ")}.`);

  return parts.join("\n");
}
