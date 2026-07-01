// Pure regime-composite mapping, split out of route.ts: Next.js's route-export
// validator rejects any named export from a route.ts file other than the
// HTTP method handlers and its handful of config constants, so this couldn't
// live (and be exported for tests) alongside GET().
export function deriveComposite(
  gexRegime: string,
  trendRegime: string,
  flowRegime: string
): { composite: string; playbook: string } {
  const g = (gexRegime ?? "").toLowerCase();
  const t = trendRegime;
  const f = flowRegime;

  // GEX regime drives the primary label.
  // gammaRegime() (src/lib/providers/gamma-desk.ts) only ever returns
  // "mean_revert" | "amplification" | "unknown" — never "long"/"short".
  if (g === "mean_revert" && t === "up")
    return { composite: "MEAN_REVERT_TRENDING_UP", playbook: "Dealers long gamma — expect mean reversion. Trend is up; longs favored but expect snap-backs to VWAP/walls." };
  if (g === "mean_revert" && t === "down")
    return { composite: "MEAN_REVERT_TRENDING_DOWN", playbook: "Dealers long gamma — mean reversion expected. Trend is down; puts favored near resistance; fade extreme moves." };
  if (g === "amplification" && t === "up")
    return { composite: "AMPLIFY_BREAKOUT", playbook: "Dealers short gamma — moves amplify. Trend up with breakout risk; calls favored; ride momentum, avoid fades." };
  if (g === "amplification" && t === "down")
    return { composite: "AMPLIFY_BREAKDOWN", playbook: "Dealers short gamma — breakdown risk. Trend down; puts favored; momentum plays over mean-reversion." };
  if (g === "amplification")
    return { composite: "AMPLIFY_MIXED", playbook: "Dealers short gamma — volatile, choppy. Flow is " + f + "; size down, tight stops." };
  if (g === "mean_revert")
    return { composite: "MEAN_REVERT_MIXED", playbook: "Dealers long gamma — mean reversion dominant. Flow is " + f + "; scalp ranges, avoid trend plays." };
  return { composite: "NEUTRAL", playbook: "No strong GEX regime signal. Trade cautiously with reduced size." };
}
