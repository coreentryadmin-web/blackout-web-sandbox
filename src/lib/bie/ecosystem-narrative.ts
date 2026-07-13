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

  // #60 arsenal — the Track-B provider color, relevance-gated onto the shared context. Cited here so
  // the ecosystem narrative (not only the verdict) surfaces macro/earnings/breadth/short-interest.
  const ars = ctx.arsenal;
  if (ars.earnings?.earnings_date) {
    const e = ars.earnings;
    lead.push(
      `**earnings ${e.days_until != null ? `${e.days_until}d out` : e.earnings_date}**${e.report_time && e.report_time !== "unknown" ? ` (${e.report_time})` : ""}${e.is_confirmed ? ", confirmed" : ""}`
    );
  }
  if (ars.macro && (ars.macro.yield_10_year != null || ars.macro.cpi != null)) {
    const m = ars.macro;
    const bits: string[] = [];
    if (m.yield_10_year != null) bits.push(`10y ${fmt(m.yield_10_year, 2)}%`);
    if (m.curve_10y_1y_spread != null) bits.push(`10y-1y ${fmt(m.curve_10y_1y_spread, 2)}${m.curve_10y_1y_spread < 0 ? " (inverted)" : ""}`);
    if (m.cpi != null) bits.push(`CPI ${fmt(m.cpi, 1)}`);
    if (bits.length) lead.push(`macro: ${bits.join(", ")}`);
  }
  if (ars.breadth) lead.push(ars.breadth.summary || `breadth ${ars.breadth.tone}`);

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
  // Short interest is a "watch" signal (squeeze fuel), only when it's actually elevated.
  if (ars.fundamentals?.days_to_cover != null && ars.fundamentals.days_to_cover >= 5) {
    watch.push(`high days-to-cover ${fmt(ars.fundamentals.days_to_cover, 1)} (squeeze fuel)`);
  }
  if (ars.news && ars.news.count > 0) {
    watch.push(`${ars.news.count} recent ${ctx.arsenal.scope === "index" ? "catalyst" : "news"}${ars.news.count === 1 ? "" : "s"}${ars.news.headlines[0] ? ` — "${ars.news.headlines[0]}"` : ""}`);
  }
  if (ars.related && ars.related.length) {
    watch.push(`peers ${ars.related.slice(0, 4).join(", ")}`);
  }

  const parts = [
    `**${t} — cross-instrument read**`,
    "",
    lead.join(". ") + ".",
  ];
  if (conflict.length) parts.push("", `**Friction:** ${conflict.join(" · ")}.`);
  if (watch.length) parts.push("", `**Watch:** ${watch.join(" · ")}.`);
  // Honesty spine: name the requested-but-thin arsenal legs, never silently drop them.
  if (ars.unavailable_sources.length) {
    parts.push("", `_Unavailable this turn: ${ars.unavailable_sources.map((u) => `${u.source} (${u.reason})`).join(", ")}._`);
  }

  return parts.join("\n");
}
