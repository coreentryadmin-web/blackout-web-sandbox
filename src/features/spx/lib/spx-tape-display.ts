import type { SpxTapeItem } from "@/features/spx/lib/spx-desk";

const TAPE_SKEW_MIN_TOTAL = 250_000;

/** Mirror of tapeSkew() in spx-signals — top 8 flow prints for UI strip. */
export function computeTapeSkew(tape: SpxTapeItem[] | undefined): {
  bull: number;
  bear: number;
  skew: "call" | "put" | "neutral";
} {
  let bull = 0;
  let bear = 0;
  for (const t of (tape ?? []).filter((x) => x.kind === "flow").slice(0, 8)) {
    if (t.side === "call") bull += t.premium ?? 0;
    else if (t.side === "put") bear += t.premium ?? 0;
  }
  const total = bull + bear;
  let skew: "call" | "put" | "neutral" = "neutral";
  if (total >= TAPE_SKEW_MIN_TOTAL) {
    if (bull >= bear * 1.25) skew = "call";
    else if (bear >= bull * 1.25) skew = "put";
  }
  return { bull, bear, skew };
}

export function fmtTapePremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
