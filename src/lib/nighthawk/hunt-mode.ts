import type { AgentFilterValues } from "./types";
import type { HuntMode } from "./types";
import type { ScoredCandidate } from "./scorer";

export type HuntModeWeights = {
  maxDte: number;
  minLiquidity: number;
  sweepBonus: number;
  streakWeight: number;
};

export type NormalizedHuntFilters = {
  sector: string | null;
  min_score: number | null;
  direction: "any" | "bull" | "bear";
  min_conviction: "A+" | "A" | "B" | null;
  watchlist: string[];
  min_streak: number | null;
  max_iv_rank: number | null;
  min_premium: number | null;
  /** Day mode: user max DTE (0 or 1). */
  max_dte: number | null;
  /** Day mode: require SPX desk alignment. */
  spx_context: boolean;
};

export function huntModeWeights(mode: HuntMode): HuntModeWeights {
  switch (mode) {
    case "day":
      return { maxDte: 5, minLiquidity: 500_000, sweepBonus: 1.5, streakWeight: 1.0 };
    case "swing":
      return { maxDte: 30, minLiquidity: 250_000, sweepBonus: 1.2, streakWeight: 1.3 };
    case "leap":
      return { maxDte: 90, minLiquidity: 100_000, sweepBonus: 1.0, streakWeight: 0.8 };
  }
}

export function normalizeHuntFilters(
  mode: HuntMode,
  filters: AgentFilterValues
): NormalizedHuntFilters {
  const weights = huntModeWeights(mode);
  const directionRaw = String(filters.direction ?? "any").toLowerCase();
  const direction =
    directionRaw === "bull" || directionRaw === "bear" ? directionRaw : ("any" as const);

  const watchlistRaw = String(filters.watchlist ?? "")
    .split(/[,\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const minPremium = Number(filters.min_premium);
  const parsedMinPremium = Number.isFinite(minPremium) && minPremium > 0 ? minPremium : null;

  const maxDteRaw = Number(filters.max_dte);
  const max_dte =
    mode === "day" && Number.isFinite(maxDteRaw) && maxDteRaw >= 0 && maxDteRaw <= 1
      ? maxDteRaw
      : null;

  const spx_context =
    mode === "day" ? filters.spx_context !== false && String(filters.spx_context) !== "false" : false;

  return {
    sector: String(filters.sector ?? "").trim() || null,
    min_score: Number.isFinite(Number(filters.min_score))
      ? Number(filters.min_score)
      : null,
    direction,
    min_conviction: parseMinConviction(filters.min_conviction),
    watchlist: watchlistRaw,
    min_streak: Number.isFinite(Number(filters.min_streak)) ? Number(filters.min_streak) : null,
    max_iv_rank: Number.isFinite(Number(filters.max_iv_rank)) ? Number(filters.max_iv_rank) : null,
    min_premium: parsedMinPremium ?? weights.minLiquidity,
    max_dte,
    spx_context,
  };
}

function parseMinConviction(v: unknown): "A+" | "A" | "B" | null {
  const s = String(v ?? "").toUpperCase();
  if (s === "A+" || s === "A" || s === "B") return s;
  return null;
}

const CONVICTION_RANK: Record<string, number> = { C: 0, B: 1, A: 2, "A+": 3 };

export function meetsMinConviction(conviction: string, min: "A+" | "A" | "B"): boolean {
  return (CONVICTION_RANK[conviction] ?? 0) >= (CONVICTION_RANK[min] ?? 0);
}

export function applyHuntScoreFilters(
  scored: ScoredCandidate[],
  filters: NormalizedHuntFilters
): ScoredCandidate[] {
  let list = [...scored];
  if (filters.min_score != null) {
    list = list.filter((s) => s.score >= filters.min_score!);
  }
  if (filters.direction === "bull") {
    list = list.filter((s) => s.direction === "long");
  } else if (filters.direction === "bear") {
    list = list.filter((s) => s.direction === "short");
  }
  if (filters.min_conviction) {
    list = list.filter((s) => meetsMinConviction(s.conviction, filters.min_conviction!));
  }
  return list;
}

export function huntDteGuidance(mode: HuntMode, maxDte: number): string {
  switch (mode) {
    case "day":
      return `Day-trade hunt — prefer 0DTE to ${Math.min(maxDte, 1)} DTE contracts only.`;
    case "swing":
      return `Swing hunt — prefer 2–${maxDte} DTE contracts.`;
    case "leap":
      return `LEAP hunt — prefer ${Math.max(30, maxDte - 60)}–${maxDte}+ DTE contracts.`;
  }
}
