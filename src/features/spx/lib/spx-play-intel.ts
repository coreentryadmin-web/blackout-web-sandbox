import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";
import { gradeRank } from "@/features/spx/lib/spx-play-config";
import { keyLevelForDirection } from "@/features/spx/lib/spx-play-mtf";
import { round5 } from "@/lib/round5";

export type PlayIdea = {
  direction: SpxPlayDirection;
  option_type: "call" | "put";
  strike: number;
  line: string;
};

function resolveLeanDirection(
  desk: SpxDeskPayload,
  confluence: SpxConfluence
): SpxPlayDirection {
  if (confluence.direction === "long" || confluence.direction === "short") {
    return confluence.direction;
  }
  if (confluence.bias === "bullish") return "long";
  if (confluence.bias === "bearish") return "short";
  if (confluence.score >= 12) return "long";
  if (confluence.score <= -12) return "short";
  return desk.above_vwap ? "long" : "short";
}

function topFactorDetail(confluence: SpxConfluence, direction: SpxPlayDirection): string | null {
  const aligned = confluence.factors.filter((f) =>
    direction === "long" ? f.weight > 0 : f.weight < 0
  );
  aligned.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const top = aligned[0];
  if (!top) return null;
  return top.detail.replace(/\s+/g, " ").trim();
}

function anchorPhrase(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  direction: SpxPlayDirection
): string | null {
  const key = keyLevelForDirection(desk, direction, confluence);
  if (direction === "long") {
    if (desk.vwap != null && desk.price >= desk.vwap) {
      return `above VWAP ${desk.vwap.toFixed(0)}`;
    }
    const support = desk.gex_walls?.find((w) => w.kind === "support");
    if (support) return `above ${support.strike.toFixed(0)} support`;
    return `above ${key.toFixed(0)}`;
  }
  if (desk.vwap != null && desk.price <= desk.vwap) {
    return `below VWAP ${desk.vwap.toFixed(0)}`;
  }
  const resist = desk.gex_walls?.find((w) => w.kind === "resistance");
  if (resist) return `below ${resist.strike.toFixed(0)} resistance`;
  return `below ${key.toFixed(0)}`;
}

/** Sync strike suggestion — mirrors option ticket ladder without chain fetch. */
export function suggestPlayStrike(
  desk: SpxDeskPayload,
  direction: SpxPlayDirection,
  grade: string
): number {
  const spot = desk.price;
  const atm = round5(spot);
  const otmSteps = gradeRank(grade) >= 3 ? 0 : 1;
  const walls = desk.gex_walls ?? [];

  if (direction === "long") {
    const support = walls
      .filter((w) => w.kind === "support" && w.strike <= spot + 20)
      .sort((a, b) => b.strike - a.strike)[0];
    if (support) return round5(Math.max(support.strike, atm));
    return atm + otmSteps * 5;
  }

  const resist = walls
    .filter((w) => w.kind === "resistance" && w.strike >= spot - 20)
    .sort((a, b) => a.strike - b.strike)[0];
  if (resist) return round5(Math.min(resist.strike, atm));
  return atm - otmSteps * 5;
}

export function buildPlayIdea(desk: SpxDeskPayload, confluence: SpxConfluence): PlayIdea | null {
  if (!desk.price || desk.price <= 0) return null;

  const direction = resolveLeanDirection(desk, confluence);
  const option_type = direction === "long" ? "call" : "put";
  const strike = suggestPlayStrike(desk, direction, confluence.grade);
  const side = direction === "long" ? "Calls" : "Puts";
  const contract = option_type === "call" ? "Call" : "Put";
  const anchor = anchorPhrase(desk, confluence, direction);
  const factor = topFactorDetail(confluence, direction);
  const target = confluence.levels.target;
  const grade = gradeRank(confluence.grade);

  let line: string;
  if (grade >= 4 && confluence.conflicts <= 1) {
    line = `I like ${side} here — ${strike} ${contract} is the play`;
    if (target != null) line += ` · target +${Math.abs(target - desk.price).toFixed(0)} pts (${target.toFixed(0)})`;
    else if (anchor) line += ` · hold ${anchor}`;
  } else if (grade >= 3) {
    line = `I like ${side} here — ${strike} ${contract} could be the play`;
    if (target != null) line += ` · ±${Math.abs(target - desk.price).toFixed(0)}pt target`;
    else if (anchor) line += ` if we hold ${anchor}`;
  } else if (confluence.conflicts >= 3) {
    line = `Tape's mixed, but ${side} lean — ${strike} ${contract} on watch`;
    if (factor) line += ` · ${factor}`;
  } else {
    line = `Leaning ${side} — ${strike} ${contract} could be the play`;
    if (anchor) line += ` off ${anchor}`;
    else if (factor) line += ` · ${factor}`;
  }

  return { direction, option_type, strike, line };
}

export function buildPlayIdeaIntel(desk: SpxDeskPayload, confluence: SpxConfluence): string | null {
  return buildPlayIdea(desk, confluence)?.line ?? null;
}

/** Replace generic gate copy with actionable desk intel when possible. */
export function humanizeGateBlock(
  block: string,
  desk: SpxDeskPayload,
  confluence: SpxConfluence
): string {
  if (block.includes("headwinds") || block.includes("too many conflicts")) {
    return buildPlayIdeaIntel(desk, confluence) ?? block;
  }
  if (block.includes("too low — quality setups only")) {
    const idea = buildPlayIdeaIntel(desk, confluence);
    if (idea) return idea;
  }
  if (block.includes("below minimum")) {
    const idea = buildPlayIdeaIntel(desk, confluence);
    if (idea) return `${idea} · waiting for grade confirmation`;
  }
  if (block.includes("Confirmations") && block.includes("need stronger alignment")) {
    const idea = buildPlayIdeaIntel(desk, confluence);
    if (idea) return `${idea} · confirmations still building`;
  }
  return block;
}

export function humanizeGateBlocks(
  blocks: string[],
  desk: SpxDeskPayload,
  confluence: SpxConfluence
): string[] {
  return blocks.map((b) => humanizeGateBlock(b, desk, confluence));
}
