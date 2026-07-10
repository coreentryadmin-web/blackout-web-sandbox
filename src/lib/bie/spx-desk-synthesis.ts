// BLACKOUT Intelligence Engine — Layer 3 synthesis (deterministic reasoning).
// Turns raw desk + matrix + cross-tool state into trader-grade thesis, dealer
// mechanics, alignment, and friction — no LLM; every clause traces to inputs.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence, SpxConfluenceGrade } from "@/features/spx/lib/spx-signals";
import type { SpxDeskBriefCross } from "@/lib/bie/spx-desk-brief";
import type { SpxDeskBriefIntel } from "@/lib/bie/spx-desk-intel";

export type DeskSynthesis = {
  thesis: string;
  mechanic: string | null;
  alignment: string | null;
  friction: string | null;
  watch: string[];
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function n(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "{{—}}";
  return `{{${fmt(n, d)}}}`;
}

function signedPts(dist: number): string {
  const sign = dist >= 0 ? "+" : "";
  return `{{${sign}${dist.toFixed(0)}}}`;
}

function topWeightedFactors(confluence: SpxConfluence, count = 3): SpxConfluence["factors"] {
  return [...confluence.factors].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, count);
}

function opposingFactors(confluence: SpxConfluence): SpxConfluence["factors"] {
  const dir = confluence.direction;
  if (!dir) return [];
  return confluence.factors
    .filter((f) => (dir === "long" && f.weight < -0.05) || (dir === "short" && f.weight > 0.05))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 2);
}

function gammaMechanicSentence(desk: SpxDeskPayload): string {
  const flip = desk.gamma_flip;
  const above = desk.above_gamma_flip;
  if (flip == null) return "dealer γ posture unclear — treat levels as soft until matrix refreshes";
  if (above) {
    return `above γflip ${n(flip, 0)} — dealers long γ, dips tend to get bought (pin/mean-revert bias)`;
  }
  return `below γflip ${n(flip, 0)} — dealers short γ, breaks accelerate (trend-fuel bias)`;
}

function vannaDexCharmMechanic(intel: SpxDeskBriefIntel | undefined): string | null {
  const p = intel?.positioning;
  if (!p) return null;
  const bits: string[] = [];
  if (p.vanna_posture) {
    bits.push(
      `vanna {{${p.vanna_posture}}}${p.vanna_regime_read ? ` (${p.vanna_regime_read.slice(0, 42)})` : ""}`
    );
  }
  if (p.dex_posture) {
    bits.push(`delta {{${p.dex_posture}}}${p.dex_regime_read ? ` (${p.dex_regime_read.slice(0, 36)})` : ""}`);
  }
  if (p.charm_posture) {
    bits.push(
      `charm {{${p.charm_posture}}}${p.charm_regime_read ? ` (${p.charm_regime_read.slice(0, 36)})` : ""}`
    );
  }
  if (!bits.length) return null;
  return bits.join(" · ");
}

function flowSkewLabel(desk: SpxDeskPayload): string | null {
  const net = desk.flow_0dte_net;
  if (net == null) return null;
  if (net > 200_000) return "0DTE flow call-led";
  if (net < -200_000) return "0DTE flow put-led";
  return null;
}

function crossToolAlignment(
  confluence: SpxConfluence,
  cross: SpxDeskBriefCross | undefined
): string | null {
  const readBias = confluence.bias;
  const parts: string[] = [`read {{${readBias}}}`];

  const op = cross?.openPlay;
  if (op?.status === "open") {
    const engineBull = op.direction === "long";
    const aligned =
      (engineBull && readBias === "bullish") || (!engineBull && readBias === "bearish");
    parts.push(
      aligned
        ? `ENGINE aligned (live {{${op.direction.toUpperCase()}}})`
        : `ENGINE conflicts (live {{${op.direction.toUpperCase()}}} vs read)`
    );
  }

  const nh = cross?.intel?.nighthawk;
  const spxPlay = nh?.available
    ? nh.plays.find((p) => /^(SPX|SPXW)$/i.test(p.ticker)) ?? nh.plays[0]
    : null;
  if (spxPlay) {
    const nhBull = /long|bull/i.test(spxPlay.direction);
    const aligned =
      (nhBull && readBias === "bullish") || (!nhBull && readBias === "bearish");
    parts.push(
      aligned
        ? `NIGHT HAWK aligned ({{${spxPlay.direction.toUpperCase()}}} #${spxPlay.rank})`
        : `NIGHT HAWK diverges ({{${spxPlay.direction.toUpperCase()}}} #${spxPlay.rank})`
    );
  }

  const lp = cross?.lotto;
  if (lp && lp.phase !== "NONE" && lp.phase !== "INVALID" && lp.direction) {
    const lottoBull = lp.direction === "long";
    const aligned =
      (lottoBull && readBias === "bullish") || (!lottoBull && readBias === "bearish");
    parts.push(aligned ? `LOTTO aligned` : `LOTTO diverges ({{${lp.phase}}})`);
  }

  if (parts.length <= 1) return null;
  return `ALIGNMENT  ${parts.join(" · ")}`;
}

function buildWatchTriggers(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  sessionPhase: string
): string[] {
  const out: string[] = [];
  const price = desk.price;
  if (price == null) return out;

  if (desk.gamma_flip != null) {
    out.push(`γflip ${n(desk.gamma_flip, 0)} (regime pivot)`);
  }
  if (desk.vwap != null) {
    out.push(`VWAP ${n(desk.vwap, 0)} (${signedPts(desk.vwap - price)} away)`);
  }
  const { stop, target } = confluence.levels;
  if (stop != null) out.push(`invalidation ${n(stop, 0)}`);
  if (target != null) out.push(`target ${n(target, 0)}`);

  const walls = desk.gex_walls ?? [];
  const nearRes = walls
    .filter((w) => w.kind === "resistance" && w.strike >= price)
    .sort((a, b) => a.strike - b.strike)[0];
  const nearSup = walls
    .filter((w) => w.kind === "support" && w.strike <= price)
    .sort((a, b) => b.strike - a.strike)[0];
  if (nearRes) out.push(`call wall ${n(nearRes.strike, 0)}`);
  if (nearSup) out.push(`put wall ${n(nearSup.strike, 0)}`);

  if (sessionPhase === "power-hour") out.push("power-hour squeeze window");
  if (sessionPhase === "final-30") out.push("final-30 — manage only");

  return out.slice(0, 5);
}

function gradeConfidenceLabel(grade: SpxConfluenceGrade, score: number): string {
  if (grade === "A+" || grade === "A") return `high conviction ({{${grade}}} / score {{${score.toFixed(0)}}})`;
  if (grade === "B") return `moderate edge ({{${grade}}} / score {{${score.toFixed(0)}}})`;
  return `low edge ({{${grade}}} / score {{${score.toFixed(0)}}})`;
}

/**
 * Synthesize the intelligence layer on top of raw desk + confluence + intel.
 * Used by Live Desk brief, Largo SPX read, and SPX "why" routing.
 */
export function synthesizeSpxDeskIntel(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  sessionPhase: string,
  cross?: SpxDeskBriefCross
): DeskSynthesis {
  const intel = cross?.intel;
  const price = desk.price;
  const tops = topWeightedFactors(confluence, 3);
  const factorClause = tops.map((f) => `${f.label} (${f.detail.slice(0, 40)})`).join(" · ");

  const gammaClause = gammaMechanicSentence(desk);
  const flowClause = flowSkewLabel(desk);
  const vwapClause =
    desk.vwap != null && price != null
      ? `${price >= desk.vwap ? "above" : "below"} VWAP ${n(desk.vwap, 0)}`
      : null;

  const thesisParts = [
    `${confluence.bias.toUpperCase()} tape — ${gradeConfidenceLabel(confluence.grade, confluence.score)}`,
    factorClause || confluence.thesis?.slice(0, 120),
    gammaClause,
    flowClause,
    vwapClause,
  ].filter(Boolean);

  const thesis = `THESIS  ${thesisParts.join(" · ")}.`;

  const greekExtra = vannaDexCharmMechanic(intel);
  const mechanic = `MECHANIC  ${gammaClause}${greekExtra ? ` · ${greekExtra}` : ""}.`;

  const alignment = crossToolAlignment(confluence, cross);

  let friction: string | null = null;
  const opposers = opposingFactors(confluence);
  if (opposers.length > 0 || confluence.weighted_conflicts > 0.15) {
    const oppClause = opposers.map((f) => `${f.label} (${f.detail.slice(0, 36)})`).join(" · ");
    friction = `FRICTION  ${oppClause || "mixed factor weights"} · weighted conflicts {{${confluence.weighted_conflicts.toFixed(2)}}} · {{${confluence.agreeing}}} factors agree`;
  }

  const watch = buildWatchTriggers(desk, confluence, sessionPhase);

  return {
    thesis,
    mechanic,
    alignment,
    friction,
    watch,
  };
}

/** Markdown-friendly synthesis block for Largo (bullets + watch list). */
export function formatDeskSynthesisMarkdown(synthesis: DeskSynthesis): string {
  const lines = [synthesis.thesis, synthesis.mechanic];
  if (synthesis.alignment) lines.push(synthesis.alignment);
  if (synthesis.friction) lines.push(synthesis.friction);
  if (synthesis.watch.length) {
    lines.push("", "**Watch triggers**", ...synthesis.watch.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}
