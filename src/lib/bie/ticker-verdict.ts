// Deterministic ticker verdict — advice-shaped questions without Claude.

import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import { findSimilarPrecedents } from "@/lib/bie/precedent-search";

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
  const lines: string[] = [`**${t} — desk verdict**`, ""];

  const eventRisk =
    /\b(earnings|cpi|fomc|opex|expir|into the)\b/i.test(question) ? "HIGH event-window risk" : null;

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
  if (align.length) lines.push(`ALIGNMENT  ${align.join(" · ")}`);

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

  lines.push(
    "",
    "_Desk verdict from Night Hawk, 0DTE Command, HELIX flow, and Thermal GEX — zero Claude cost._"
  );

  return { lines, precedentLine };
}

export function formatTickerVerdictMarkdown(v: TickerVerdict): string {
  return v.lines.join("\n");
}
