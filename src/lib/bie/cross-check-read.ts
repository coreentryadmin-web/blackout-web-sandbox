// BIE cross-surface CROSS-CHECK (PR-L4e-4) — "cross-check Vector and the SPX desk: do they agree?".
//
// The gauntlet caught the desk reporting max pain 7,525 while Vector reported 7,400 for the same
// underlying, and the answer presented ONE silently — never flagging that the two surfaces disagreed.
// A cross-check ask is asking EXACTLY that: do the surfaces agree? So this reads the same three
// clearest cross-surface metrics — max pain, gamma flip, regime posture — from BOTH the SPX Live Desk
// and the Vector engine, and FLAGS a material divergence explicitly instead of choosing a side.
//
// Deterministic, read-only, fail-soft. IO seams are dynamic RELATIVE imports (the Node-20 ESM loader
// resolves `@/`-aliased dynamic imports inconsistently under --experimental-test-module-mocks; the
// relative specifiers here match the ones a hermetic test registers with mock.module).

import type { BieComposed } from "@/lib/bie/composers-shared";

/** A metric read from one surface — value + the label the member sees. */
type SurfaceMetric = { deskValue: number | null; vectorValue: number | null };

/** Relative-divergence threshold: two price levels differ MATERIALLY when they're >0.3% apart. At
 *  SPX ~7,500 that's ~22 pts — well below the 125-pt gap the gauntlet caught, well above rounding. */
const MATERIAL_REL_DIFF = 0.003;

/** True when two finite numbers differ materially (relative gap over threshold + a small abs floor so
 *  sub-point noise on a low-priced ticker never trips it). Null on either side → not comparable. */
export function metricsMateriallyDiffer(a: number | null, b: number | null): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  if (diff < 1) return false;
  const mid = (Math.abs(a) + Math.abs(b)) / 2;
  if (mid === 0) return false;
  return diff / mid > MATERIAL_REL_DIFF;
}

/** Coarse gamma posture from either surface's regime vocabulary: negative-γ (trend/amplification) vs
 *  positive-γ (mean-revert/pinning). Unknown when the wording maps to neither — never guessed. */
export function coarsePosture(regime: string | null | undefined): "positive-γ" | "negative-γ" | null {
  if (!regime) return null;
  const r = regime.toLowerCase();
  if (/neg|amplif|trend|short[-_\s]?gamma/.test(r)) return "negative-γ";
  if (/pos|mean[-_\s]?rev|pin|long[-_\s]?gamma/.test(r)) return "positive-γ";
  return null;
}

function fmtPx(n: number | null): string {
  return n != null && Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";
}

/** One metric comparison line + whether it materially disagrees. */
function priceLine(label: string, m: SurfaceMetric): { line: string; disagree: boolean } {
  const disagree = metricsMateriallyDiffer(m.deskValue, m.vectorValue);
  if (m.deskValue == null || m.vectorValue == null) {
    const which = m.deskValue == null && m.vectorValue == null ? "neither surface" : m.deskValue == null ? "the desk" : "Vector";
    return { line: `- ${label} — desk ${fmtPx(m.deskValue)} vs Vector ${fmtPx(m.vectorValue)} → not comparable (${which} has no read)`, disagree: false };
  }
  if (disagree) {
    const delta = Math.abs(m.deskValue - m.vectorValue);
    const pct = (delta / ((Math.abs(m.deskValue) + Math.abs(m.vectorValue)) / 2)) * 100;
    return {
      line: `- ${label} — desk ${fmtPx(m.deskValue)} vs Vector ${fmtPx(m.vectorValue)} → **DISAGREE** (Δ ${delta.toLocaleString("en-US", { maximumFractionDigits: 0 })} pts, ${pct.toFixed(1)}%)`,
      disagree: true,
    };
  }
  return { line: `- ${label} — desk ${fmtPx(m.deskValue)} vs Vector ${fmtPx(m.vectorValue)} → agree`, disagree: false };
}

/**
 * Compose the cross-surface cross-check for `ticker` (default SPX) at `horizon`. Reads the desk and
 * Vector surfaces, compares max pain / gamma flip / regime, and returns an answer whose HEADLINE flags
 * any material disagreement. Honest partial states when a surface is unavailable; never throws.
 */
export async function composeCrossCheck(ticker: string, horizon: string): Promise<BieComposed> {
  const T = ticker.toUpperCase();

  // Desk surface (SPX aggregate). Vector surface (horizon-scoped). Both fail-soft to null.
  let desk: { max_pain: number | null; gamma_flip: number | null; gamma_regime: string | null; as_of: string | null } | null = null;
  try {
    const { getCachedBiePlatformContext } = await import("./platform-cache");
    const platform = await getCachedBiePlatformContext({ scope: "desk" });
    const d = platform.desk;
    if (d) desk = { max_pain: d.max_pain ?? null, gamma_flip: d.gamma_flip ?? null, gamma_regime: d.gamma_regime ?? null, as_of: d.as_of ?? null };
  } catch {
    desk = null;
  }

  let vector: { maxPain: number | null; gammaFlip: number | null; regime: string | null } | null = null;
  try {
    const [{ fetchVectorFullState }, { normalizeDteHorizon }] = await Promise.all([
      import("./vector-full-state"),
      import("../../features/vector/lib/vector-dte-horizon"),
    ]);
    const state = await fetchVectorFullState(T, normalizeDteHorizon(horizon));
    if (state) vector = { maxPain: state.maxPain ?? null, gammaFlip: state.gammaFlip ?? null, regime: state.regime?.posture ?? null };
  } catch {
    vector = null;
  }

  // If a whole surface is missing, we cannot honestly cross-check — say so, don't dump one side.
  if (!desk || !vector) {
    const missing = !desk && !vector ? "neither the SPX desk nor Vector" : !desk ? "the SPX desk" : "Vector";
    const answer = [
      `**Cross-surface check — ${T}: desk vs Vector**`,
      "",
      `I can't cross-check right now — ${missing} returned no live read this turn. I won't present one ` +
        `surface as if it were both. Try again shortly, or ask each surface directly.`,
    ].join("\n");
    return { answer, context: { intent: "cross_check", ticker: T, unavailable: missing } };
  }

  const rows = [
    priceLine("Max pain", { deskValue: desk.max_pain, vectorValue: vector.maxPain }),
    priceLine("Gamma flip", { deskValue: desk.gamma_flip, vectorValue: vector.gammaFlip }),
  ];
  const deskPosture = coarsePosture(desk.gamma_regime);
  const vecPosture = coarsePosture(vector.regime);
  const regimeDisagree = deskPosture != null && vecPosture != null && deskPosture !== vecPosture;
  const regimeLine =
    deskPosture == null || vecPosture == null
      ? `- Regime — desk ${deskPosture ?? desk.gamma_regime ?? "—"} vs Vector ${vecPosture ?? vector.regime ?? "—"} → not comparable`
      : regimeDisagree
        ? `- Regime — desk ${deskPosture} vs Vector ${vecPosture} → **DISAGREE**`
        : `- Regime — desk ${deskPosture} vs Vector ${vecPosture} → agree`;

  const disagreements: string[] = [];
  if (rows[0]!.disagree) disagreements.push("max pain");
  if (rows[1]!.disagree) disagreements.push("gamma flip");
  if (regimeDisagree) disagreements.push("regime");

  const headline =
    disagreements.length > 0
      ? `**The SPX desk and Vector DISAGREE on ${listAnd(disagreements)}.** Don't treat the two as one read — the surfaces are scoped/aggregated differently, so reconcile before acting on the divergent level.`
      : `**The SPX desk and Vector agree** on max pain, gamma flip, and regime — the surfaces line up.`;

  const answer = [
    `**Cross-surface check — ${T}: desk vs Vector (${horizon.toUpperCase()})**`,
    "",
    headline,
    "",
    rows[0]!.line,
    rows[1]!.line,
    regimeLine,
  ].join("\n");

  return {
    answer,
    context: {
      intent: "cross_check",
      ticker: T,
      horizon,
      disagreements,
      desk: { max_pain: desk.max_pain, gamma_flip: desk.gamma_flip, regime: deskPosture },
      vector: { max_pain: vector.maxPain, gamma_flip: vector.gammaFlip, regime: vecPosture },
    },
  };
}

/** "a", "a and b", "a, b, and c". */
function listAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
