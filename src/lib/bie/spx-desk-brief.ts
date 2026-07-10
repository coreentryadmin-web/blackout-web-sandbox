// BLACKOUT Intelligence Engine — deterministic Live Desk AI brief for SPX Slayer.
// Replaces Claude Haiku on /api/market/spx/commentary: every number traces to the
// same desk + confluence readers the play engine uses; optional Voyage precedent
// color is additive only.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence, SpxConfluenceGrade } from "@/features/spx/lib/spx-signals";
import { formatFlowStrikeStackLine } from "@/lib/largo/flow-strike-stacks";
import { fmtPremium } from "@/lib/fmt-money";

export type SpxDeskBriefResult = {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  watch: string[];
  changed: string[];
  as_of: string;
};

export type SpxDeskBriefCross = {
  openPlay?: {
    status: string;
    direction: string;
    entry_price: number | null;
    stop: number | null;
    target: number | null;
    grade: string | null;
  } | null;
  lotto?: {
    phase: string;
    direction: string | null;
    strike: number | null;
  } | null;
  powerHour?: {
    phase: string;
    direction: string | null;
    strike: number | null;
  } | null;
  outcomes?: {
    overall: { win_rate: number; wins: number; losses: number };
    total_closed: number;
  } | null;
  precedentDetail?: string | null;
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

function nearestWall(
  walls: SpxDeskPayload["gex_walls"],
  kind: "support" | "resistance",
  price: number
) {
  const pool = (walls ?? []).filter((w) => w.kind === kind);
  if (!pool.length) return null;
  return pool.reduce((best, w) => {
    const d = Math.abs(w.strike - price);
    const bd = Math.abs(best.strike - price);
    return d < bd ? w : best;
  });
}

function headlineVerb(action: SpxConfluence["action"], grade: SpxConfluenceGrade): string {
  if (grade === "C" || grade === "D" || action === "WAIT") return "NO-EDGE";
  if (action === "BUY_CALL") return "LONG";
  if (action === "BUY_PUT") return "SHORT";
  if (action === "HOLD") return "CHOP";
  return "NO-EDGE";
}

function gradeRank(g: SpxConfluenceGrade): number {
  return g === "A+" ? 5 : g === "A" ? 4 : g === "B" ? 3 : g === "C" ? 2 : 1;
}

function sizeLabel(grade: SpxConfluenceGrade): string {
  if (grade === "A+" || grade === "A") return "full";
  if (grade === "B") return "half";
  return "zero";
}

function gammaTag(desk: SpxDeskPayload): string {
  const regime = desk.gamma_regime ?? desk.regime ?? "unknown";
  if (regime === "amplification" || desk.above_gamma_flip === false) {
    return "neg-γ (trend fuel)";
  }
  if (regime === "mean_revert" || desk.above_gamma_flip === true) {
    return "pos-γ (dips bought)";
  }
  return desk.above_gamma_flip ? "pos-γ (dips bought)" : "neg-γ (trend fuel)";
}

function topFactors(confluence: SpxConfluence, count = 2): string {
  const sorted = [...confluence.factors].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return sorted
    .slice(0, count)
    .map((f) => f.label)
    .join(" + ");
}

function flowLine(desk: SpxDeskPayload): string | null {
  const stack = desk.strike_stacks?.[0];
  if (stack) return formatFlowStrikeStackLine(stack);

  const net = desk.flow_0dte_net;
  if (net != null && Math.abs(net) > 150_000) {
    const skew = net > 0 ? "call-led" : "put-led";
    return `0DTE ${skew} net ${fmtPremium(net)}`;
  }

  const tape = desk.unified_tape?.[0];
  if (tape?.premium && tape.premium > 250_000) {
    return `${tape.kind} ${tape.label} ${fmtPremium(tape.premium)}`;
  }

  const dp = desk.dark_pool;
  if (dp?.bias && dp.bias !== "neutral" && dp.bias !== "mixed") {
    return `dark pool ${dp.bias}${dp.pcr != null ? ` PCR ${fmt(dp.pcr, 2)}` : ""}`;
  }

  if (desk.nope != null && Math.abs(desk.nope) > 0.5) {
    return `NOPE ${desk.nope > 0 ? "+" : ""}${fmt(desk.nope, 2)}`;
  }

  return null;
}

function newsLine(desk: SpxDeskPayload): string | null {
  const headline = desk.news_headlines?.[0]?.title?.trim();
  if (headline) return headline.slice(0, 80);

  const macro = desk.macro_events?.[0];
  if (macro?.time && macro?.event) {
    return `${macro.event} ${macro.time}`;
  }

  if (desk.vix_change_pct != null && Math.abs(desk.vix_change_pct) >= 3) {
    return `VIX ${desk.vix_change_pct >= 0 ? "+" : ""}${fmt(desk.vix_change_pct, 1)}%`;
  }

  return null;
}

function deltaLine(delta: string[]): string | null {
  const material = delta.filter(
    (d) => !d.startsWith("Initial desk") && !d.startsWith("Tape quiet")
  );
  if (material.length === 0) return null;
  return material.slice(0, 2).join(" · ");
}

function liveEngineConflict(cross: SpxDeskBriefCross | undefined, bias: SpxConfluence["bias"]): string | null {
  const op = cross?.openPlay;
  if (!op || op.status !== "open") return null;
  const engineBull = op.direction === "long";
  const readBull = bias === "bullish";
  const readBear = bias === "bearish";
  if ((engineBull && readBear) || (!engineBull && readBull)) {
    return `engine still ${op.direction} from ${n(op.entry_price, 0)} — read conflicts`;
  }
  return null;
}

/** Deterministic Live Desk AI brief — same SpxCommentaryResult shape the rail expects. */
export function composeSpxDeskBrief(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  delta: string[],
  sessionPhase: string,
  cross?: SpxDeskBriefCross
): SpxDeskBriefResult {
  const price = desk.price!;
  const grade = confluence.grade;
  const verb = headlineVerb(confluence.action, grade);
  const bias = confluence.bias;
  const changePct = desk.spx_change_pct;
  const vwapDist =
    desk.vwap != null && Number.isFinite(desk.vwap) ? price - desk.vwap : null;
  const vwapClause =
    vwapDist != null
      ? `${signedPts(vwapDist)} vs VWAP`
      : desk.above_vwap
        ? "above VWAP"
        : "below VWAP";

  const headline = [
    verb,
    `${n(price, 0)}`,
    changePct != null ? `${n(changePct, 2)}%` : "",
    vwapClause,
    desk.gamma_flip != null ? `γflip ${n(desk.gamma_flip, 0)}` : "",
    `{{${grade}}} (signals)`,
    gammaTag(desk),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  const support = nearestWall(desk.gex_walls, "support", price);
  const resistance = nearestWall(desk.gex_walls, "resistance", price);
  const factors = topFactors(confluence, 2);
  const gammaWord = desk.above_gamma_flip ? "above" : "below";
  const pin = desk.gex_king ?? desk.max_pain;

  const whyParts: string[] = [];
  if (factors) whyParts.push(`${factors} align`);
  if (desk.gamma_flip != null) {
    whyParts.push(
      `${gammaWord} γflip ${n(desk.gamma_flip, 0)} — ${desk.above_gamma_flip ? "dealers buy dips" : "dealers sell dips"}`
    );
  }
  if (support && price > support.strike) {
    whyParts.push(`air toward ${n(support.strike, 0)} if ${n(support.strike, 0)} cracks`);
  } else if (resistance && price < resistance.strike) {
    whyParts.push(`caps near ${n(resistance.strike, 0)} call wall`);
  }
  const why = `WHY  ${whyParts.join("; ") || "Mixed tape — no single dealer mechanic dominates"}.`;

  const deltaText = deltaLine(delta);
  const deltaSince = deltaText ? `Δ SINCE LAST  ${deltaText}` : null;

  const levelParts: string[] = [];
  if (resistance && resistance.strike >= price) {
    levelParts.push(
      `R ${n(resistance.strike, 0)} (${signedPts(resistance.strike - price)}, call wall${resistance.net_gex != null ? ` ${fmtPremium(resistance.net_gex)}` : ""})`
    );
  }
  if (desk.gamma_flip != null) {
    levelParts.push(`γflip ${n(desk.gamma_flip, 0)}`);
  }
  if (support && support.strike <= price) {
    levelParts.push(
      `S ${n(support.strike, 0)} (${signedPts(support.strike - price)}, γwall${support.net_gex != null ? ` ${fmtPremium(support.net_gex)}` : ""})`
    );
  }
  if (pin != null && Math.abs(pin - price) <= 25) {
    levelParts.push(`pin ${n(pin, 0)}`);
  }
  const levels = `LEVELS  ${levelParts.join(" · ") || `${n(price, 0)} spot only`}`;

  let setup: string;
  const { stop, target } = confluence.levels;
  if (gradeRank(grade) >= 4 && confluence.action === "BUY_CALL") {
    setup = `SETUP  Long / trigger reclaim ${n(desk.vwap ?? desk.gamma_flip, 0)} / stop ${n(stop, 0)} / target ${n(target, 0)} / edge ${factors}`;
  } else if (gradeRank(grade) >= 4 && confluence.action === "BUY_PUT") {
    setup = `SETUP  Short / trigger reject ${n(desk.vwap ?? desk.gamma_flip, 0)} / stop ${n(stop, 0)} / target ${n(target, 0)} / edge ${factors}`;
  } else if (grade === "B" && confluence.direction) {
    const trigger = confluence.direction === "long" ? desk.vwap ?? desk.gamma_flip : desk.vwap ?? desk.gamma_flip;
    setup = `SETUP  If ${n(trigger, 0)} ${confluence.direction === "long" ? "reclaims" : "rejects"} then ${confluence.direction} toward ${n(target, 0)}`;
  } else {
    setup = `SETUP  No clean setup — grade {{${grade}}} signals split; flat until VWAP+γflip agree`;
  }

  const conflict = liveEngineConflict(cross, bias);
  if (conflict) setup += ` (${conflict})`;

  const ivRank = desk.uw_iv_rank;
  const size = sizeLabel(grade);
  const staleNote =
    desk.gex_stale || desk.feed_stalled
      ? " GEX/feed stale — lighter size until refresh."
      : "";
  const structure =
    ivRank != null && ivRank > 50
      ? "debit spread (capped risk)"
      : ivRank != null && ivRank < 30
        ? "single long OK"
        : "defined-risk only";
  const risk = `RISK  Size {{${size}}} — {{${grade}}}; IV rank ${ivRank != null ? n(ivRank, 0) : "{{—}}"} → ${structure}; max loss = premium paid; phase {{${sessionPhase}}}.${staleNote}`;

  const next =
    desk.above_gamma_flip && support
      ? `NEXT 5M  pos-γ pin toward ${n(pin ?? support.strike, 0)} — fade extensions`
      : !desk.above_gamma_flip && resistance
        ? `NEXT 5M  neg-γ expansion risk into ${n(resistance.strike, 0)} air if ${n(support?.strike ?? desk.lod, 0)} fails`
        : `NEXT 5M  ${gammaTag(desk)} — watch ${n(desk.gamma_flip ?? price, 0)} and TICK`;

  const flipLevel = stop ?? desk.gamma_flip ?? desk.vwap;
  const flips = `FLIPS IT  ${confluence.direction === "long" ? "Lose" : confluence.direction === "short" ? "Reclaim" : "Break"} ${n(flipLevel, 0)} = thesis dead — go flat.`;

  const bodyLines = [why, deltaSince, levels, setup, risk, next, flips].filter(Boolean) as string[];

  const flow = flowLine(desk);
  if (flow) bodyLines.push(`FLOW  ${flow} — confirms ${bias === "bullish" ? "bid" : bias === "bearish" ? "offer" : "two-way"} tone`);

  const news = newsLine(desk);
  if (news) bodyLines.push(`NEWS  {{${news}}}`);

  if (cross?.precedentDetail) {
    bodyLines.push(`PRECEDENT  ${cross.precedentDetail}`);
  }

  const oc = cross?.outcomes;
  if (oc && oc.total_closed >= 5 && oc.overall.win_rate != null) {
    const wr = Math.round(oc.overall.win_rate * 100);
    bodyLines.push(
      "TRACK  Desk win rate {{" +
        wr +
        "}}% ({{" +
        oc.overall.wins +
        "}}-{{" +
        oc.overall.losses +
        "}} last {{" +
        oc.total_closed +
        "}} closed)"
    );
  }

  return {
    headline,
    bias,
    body: bodyLines.join("\n"),
    watch: [],
    changed: [],
    as_of: new Date().toISOString(),
  };
}
