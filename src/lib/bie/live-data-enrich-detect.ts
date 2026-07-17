import type { BieComposed } from "@/lib/bie/composers-shared";
import type { BieRoute } from "@/lib/bie/router";

function countNumbers(text: string): number {
  return (text.match(/\b\d[\d,.]*\b/g) ?? []).length;
}

const DATA_HEAVY_INTENTS = new Set([
  "technical_read",
  "wall_dynamics_read",
  "helix_read",
  "thermal_read",
  "ticker_advice",
  "market_context",
  "spx_structure",
  "play_suggest_read",
  "flow_tape",
  "vector_read",
  "vector_pulse_read",
  "spx_desk_read",
  "ticker_compare",
]);

/** True when the composed answer should get a live tool / provider refresh. */
export function needsLiveEnrichment(route: BieRoute, composed: BieComposed): boolean {
  const a = composed.answer;
  const ctx = composed.context as Record<string, unknown> | undefined;
  if (ctx?.missing === true) return true;
  if (/\b(cold|unavailable|couldn't compose|no live|retry when|will populate|feed is cold)\b/i.test(a)) {
    return true;
  }
  if (!DATA_HEAVY_INTENTS.has(route.intent)) return false;
  const nums = countNumbers(a);
  if (nums >= 3) return false;
  if (nums < 2) return true;
  if (a.length < 200 && route.intent !== "clarify_read") return true;
  return false;
}

export function questionWantsVectorPulse(question?: string): boolean {
  if (!question) return false;
  return /\b(pulse|bead rail|beads?|what just changed|recent signals?|live signals?|transitions?|wall events?)\b/i.test(
    question
  );
}
