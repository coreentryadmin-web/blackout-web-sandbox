import type { FlowAlert } from "@/lib/api";

export const HELIX_TOP_PRINTS_LIMIT = 6;
export const HELIX_TOP_PRINTS_MIN_SCORE = 5;

export type TopPrintsMode = "score" | "premium";

/** Top conviction rows for the analytics rail — score-first, premium fallback. */
export function selectTopPrints(alerts: readonly FlowAlert[]): {
  rows: FlowAlert[];
  mode: TopPrintsMode;
} {
  if (!alerts.length) return { rows: [], mode: "score" };

  const byScore = [...alerts]
    .filter((a) => a.score >= HELIX_TOP_PRINTS_MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.premium - a.premium)
    .slice(0, HELIX_TOP_PRINTS_LIMIT);

  if (byScore.length > 0) return { rows: byScore, mode: "score" };

  const byPremium = [...alerts]
    .sort((a, b) => b.premium - a.premium)
    .slice(0, HELIX_TOP_PRINTS_LIMIT);

  return { rows: byPremium, mode: "premium" };
}
