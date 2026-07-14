// Deterministic ticker verdict — advice-shaped questions without Claude.

import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import { findSimilarPrecedents } from "@/lib/bie/precedent-search";
import { sanitizeFeedText } from "@/lib/largo/sanitize-feed-text";

const fmt = (n: number | null | undefined, d = 0): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

function flowBias(ctx: EcosystemContext): "call-led" | "put-led" | "mixed" | null {
  const f = ctx.recent_flow;
  if (!f || f.print_count === 0) return null;
  const total = f.call_premium + f.put_premium;
  if (total <= 0) return null;
  const callPct = (f.call_premium / total) * 100;
  if (callPct >= 58) return "call-led";
  if (callPct <= 42) return "put-led";
  return "mixed";
}

function structuralBias(ctx: EcosystemContext): "bullish" | "bearish" | "neutral" {
  let score = 0;
  const nh = ctx.nighthawk_recent;
  if (nh) {
    if (/long|bull/i.test(nh.direction)) score += 2;
    if (/short|bear/i.test(nh.direction)) score -= 2;
    if (nh.conviction === "A" || nh.conviction === "B") score += score > 0 ? 1 : -1;
  }
  const z = ctx.zerodte_today;
  if (z) {
    if (/long|bull/i.test(z.direction)) score += 1;
    if (/short|bear/i.test(z.direction)) score -= 1;
  }
  const fb = flowBias(ctx);
  if (fb === "call-led") score += 1;
  if (fb === "put-led") score -= 1;
  const gex = ctx.gex_positioning;
  if (gex?.gamma_posture === "long") score += 1;
  if (gex?.gamma_posture === "short") score -= 1;
  if (score >= 2) return "bullish";
  if (score <= -2) return "bearish";
  return "neutral";
}

export type TickerVerdict = {
  lines: string[];
  precedentLine: string | null;
};

export async function synthesizeTickerVerdict(
  ctx: EcosystemContext,
  question: string
): Promise<TickerVerdict> {
  const t = ctx.ticker;
  const bias = structuralBias(ctx);
  const fb = flowBias(ctx);
  // #60 data arsenal — the Track-B color already folded onto the shared ecosystem context, RELEVANCE-
  // GATED at fetch time (a single name carries earnings/short-interest/peers/news; an index carries
  // macro/breadth/catalysts). Honesty: cite ONLY what's actually present here; a requested-but-thin
  // leg is surfaced verbatim from arsenal.unavailable_sources below, never fabricated.
  const ars = ctx.arsenal;
  const lines: string[] = [`**${t} — desk verdict**`, ""];

  // Real event risk now comes from the arsenal's actual earnings date too, not just question keywords:
  // an imminent confirmed print IS an event window whether or not the member typed "earnings".
  const earningsImminent = ars.earnings?.days_until != null && ars.earnings.days_until <= 5;
  const eventRisk =
    /\b(earnings|cpi|fomc|opex|expir|into the)\b/i.test(question) || earningsImminent ? "HIGH event-window risk" : null;

  lines.push(
    `VERDICT  Structure reads **${bias}**${fb ? ` · HELIX flow ${fb}` : ""}${eventRisk ? ` · ${eventRisk}` : ""} — market-structure read only, not financial advice.`
  );

  const align: string[] = [];
  if (ctx.nighthawk_recent) {
    const n = ctx.nighthawk_recent;
    align.push(`NIGHT HAWK ${n.direction.toUpperCase()} (${n.conviction})`);
  }
  if (ctx.zerodte_today) {
    const z = ctx.zerodte_today;
    align.push(`0DTE ${z.direction.toUpperCase()} score ${fmt(z.score)}`);
  }
  if (ctx.recent_flow) {
    const f = ctx.recent_flow;
    align.push(
      `flow ${f.print_count} prints · $${fmt(f.call_premium, 0)} calls / $${fmt(f.put_premium, 0)} puts`
    );
  }
  if (ctx.gex_positioning?.gamma_posture) {
    align.push(`GEX ${ctx.gex_positioning.gamma_posture} γ`);
  }
  // Elevated short interest is an asymmetric-upside (squeeze) tell — align it only when actually high.
  if (ars.fundamentals?.days_to_cover != null && ars.fundamentals.days_to_cover >= 5) {
    align.push(`days-to-cover ${fmt(ars.fundamentals.days_to_cover, 1)} (squeeze fuel)`);
  }
  if (align.length) lines.push(`ALIGNMENT  ${align.join(" · ")}`);

  // CONTEXT — the arsenal color that isn't itself a directional-bias input: the earnings countdown,
  // the macro backdrop / breadth (index), any recent news/catalysts, and peers. Cited, not scored.
  const context: string[] = [];
  if (ars.earnings?.earnings_date) {
    const e = ars.earnings;
    context.push(
      `earnings ${e.days_until != null ? `${e.days_until}d out` : e.earnings_date}${e.report_time && e.report_time !== "unknown" ? ` ${e.report_time}` : ""}${e.is_confirmed ? " (confirmed)" : ""}`
    );
  }
  if (ars.fundamentals?.days_to_cover != null && ars.fundamentals.days_to_cover < 5) {
    // Present but not elevated — still worth stating (honest: SI was read, it's just not squeeze fuel).
    context.push(`days-to-cover ${fmt(ars.fundamentals.days_to_cover, 1)}`);
  }
  if (ars.macro && (ars.macro.yield_10_year != null || ars.macro.cpi != null)) {
    const m = ars.macro;
    const bits: string[] = [];
    if (m.yield_10_year != null) bits.push(`10y ${fmt(m.yield_10_year, 2)}%`);
    if (m.curve_10y_1y_spread != null) bits.push(`10y-1y ${fmt(m.curve_10y_1y_spread, 2)}${m.curve_10y_1y_spread < 0 ? " inverted" : ""}`);
    if (m.cpi != null) bits.push(`CPI ${fmt(m.cpi, 1)}`);
    if (bits.length) context.push(`macro ${bits.join(", ")}`);
  }
  if (ars.breadth) context.push(`breadth ${ars.breadth.tone.replace(/_/g, " ")}`);
  if (ars.news && ars.news.count > 0) {
    // "news" is a mass noun (never "newss"); only "catalyst" pluralizes.
    const noun = ars.scope === "index" ? `catalyst${ars.news.count === 1 ? "" : "s"}` : "news";
    // Decode HTML entities in the raw news title before rendering — Benzinga/UW headlines arrive
    // entity-encoded ("Nvidia&#39;s"), and this line prints the title verbatim (N5-2 entity leak).
    const headline0 = ars.news.headlines[0] ? sanitizeFeedText(ars.news.headlines[0]) : "";
    context.push(`${ars.news.count} recent ${noun}${headline0 ? ` ("${headline0}")` : ""}`);
  }
  if (ars.related && ars.related.length) context.push(`peers ${ars.related.slice(0, 4).join(", ")}`);
  if (context.length) lines.push(`CONTEXT  ${context.join(" · ")}.`);

  const friction: string[] = [];
  if (ctx.recent_anomalies.length) {
    friction.push(
      ctx.recent_anomalies
        .slice(0, 3)
        .map((a) => `${a.anomaly_type} (${a.severity})`)
        .join(", ")
    );
  }
  if (!ctx.zerodte_today && /buy|sell|hold/i.test(question)) {
    friction.push("no 0DTE Command play on board today");
  }
  if (eventRisk) friction.push("event risk — size down or wait for tape post-print");
  // A confirmed imminent print makes a HOLD a binary bet, not a technical trade — state it plainly.
  if (earningsImminent && /\b(hold|buy|into|swing|overnight|keep)\b/i.test(question)) {
    friction.push(`earnings in ${ars.earnings!.days_until}d — holding through the print is a binary event, not a technical trade`);
  }
  if (fb && bias === "bullish" && fb === "put-led") friction.push("put-led flow vs bullish structure");
  if (fb && bias === "bearish" && fb === "call-led") friction.push("call-led flow vs bearish structure");
  if (!ctx.flow_feed_fresh) friction.push("flow pipeline stale — treat tape as unconfirmed");
  if (friction.length) lines.push(`FRICTION  ${friction.join(" · ")}`);

  const flip = ctx.gex_positioning?.flip;
  if (flip != null) {
    lines.push(`WHAT WOULD FLIP IT  Lose γflip ${fmt(flip, 0)} or sustained opposite-side flow >2:1 for 2h.`);
  } else if (ctx.nighthawk_recent?.outcome === "pending") {
    lines.push(`WHAT WOULD FLIP IT  NH play outcome pending — watch dossier stop/target on dashboard.`);
  }

  let precedentLine: string | null = null;
  try {
    const prec = await findSimilarPrecedents(`${t} ${bias} ${ctx.nighthawk_recent?.direction ?? ""} setup`, 3);
    if (prec.length >= 2) {
      const wins = prec.filter((p) => /win|hit target|target/i.test(p.chunk)).length;
      const pct = Math.round((wins / prec.length) * 100);
      precedentLine = `PRECEDENT  ${prec.length} similar ${t} setups in corpus — ~${pct}% positive outcomes (BIE audit log).`;
      lines.push(precedentLine);
    }
  } catch {
    /* optional */
  }

  // Honesty spine: name the arsenal legs that were requested for this ticker class but came back
  // thin/empty — surfaced, never silently dropped (mirrors the ecosystem narrative's own note).
  if (ars.unavailable_sources.length) {
    lines.push(
      `UNAVAILABLE  ${ars.unavailable_sources.map((u) => `${u.source} (${u.reason})`).join(", ")}.`
    );
  }

  lines.push(
    "",
    "_Desk verdict from Night Hawk, 0DTE Command, HELIX flow, Thermal GEX, and the data arsenal (earnings · short interest · macro/breadth · news · peers) — zero Claude cost._"
  );

  return { lines, precedentLine };
}

export function formatTickerVerdictMarkdown(v: TickerVerdict): string {
  return v.lines.join("\n");
}
