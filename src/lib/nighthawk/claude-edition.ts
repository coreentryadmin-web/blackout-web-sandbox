import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import type { TickerDossier } from "./dossier";
import { buildClaudePrompt, buildMarketRecap, type EngineState } from "./format";
import type { MarketWideContext } from "./market-wide";
import type { SpxDeskSummary, FlowTapeSummary } from "@/lib/platform/types";
import type { PlayOutcomeStats } from "@/lib/spx-play-outcomes";
import {
  fetchEditionChains,
  formatEditionChainTables,
  evaluatePlayAgainstChain,
} from "./option-chain-prompt";
import {
  applyPremiumCapToPlay,
  filterPlaysWithinPremiumCap,
  type ClaudePlayRaw,
} from "./play-constraints";
import {
  EDITION_CHAIN_PREFETCH,
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
  PLAYBOOK_PREMIUM_CAP_LINE,
} from "./constants";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";
import type { HuntMode } from "./types";

const SYSTEM = `You are an elite options strategist. Output ONLY a valid JSON array. No markdown fences. Every number and level must come from the prompt data.

HARD RULE — AFFORDABLE CONTRACTS:
${PLAYBOOK_PREMIUM_CAP_LINE}
Every play MUST include entry_premium (per-share, ≤ ${MAX_OPTION_PREMIUM_PER_SHARE}) and options_play with "entry prem ~$X.XX". Never recommend contracts above $${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()} per 1-lot.`;
function parsePlaysJson(raw: string): ClaudePlayRaw[] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as ClaudePlayRaw[];
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as ClaudePlayRaw[];
  } catch {
    return [];
  }
}

export function mapClaudePlayToEdition(play: ClaudePlayRaw, rank: number, dossiers: Record<string, TickerDossier>): PlaybookPlay {
  const ticker = String(play.ticker ?? "?").toUpperCase();
  const dossier = dossiers[ticker];
  const playType = String(play.type ?? "stock").toLowerCase();
  const base: PlaybookPlay = {
    rank,
    ticker,
    direction: String(play.direction ?? "LONG"),
    conviction: String(play.conviction ?? "B"),
    play_type: playType === "index" ? "index" : playType === "etf" ? "etf" : "stock",
    thesis: String(play.key_signal ?? play.bias ?? ""),
    key_signal: String(play.key_signal ?? ""),
    entry_range: [play.entry_condition, play.entry_range].filter(Boolean).join(" · ") || "—",
    target: [play.target, play.target_note].filter(Boolean).join(" — ") || "—",
    stop: [play.stop, play.stop_note].filter(Boolean).join(" — ") || "—",
    options_play: String(play.options_play ?? "—"),
    risk_note: String(play.risk_note ?? ""),
    score: Number(play.score ?? dossier?.scored?.score ?? 0),
    flow_streak_days: dossier?.flow_streak.streak_days || undefined,
    iv_rank: dossier?.iv_rank ?? undefined,
  };
  return applyPremiumCapToPlay(base, play);
}

export async function generateEditionPlays(params: {
  ctx: MarketWideContext;
  dossiers: TickerDossier[];
  ranked: ScoredCandidate[];
  huntMode?: HuntMode;
  maxDte?: number;
  engineState?: EngineState | null;
  spxDesk?: SpxDeskSummary | null;
  flowTape?: FlowTapeSummary | null;
  playOutcomes?: PlayOutcomeStats | null;
}): Promise<{
  plays: PlaybookPlay[];
  recap: ReturnType<typeof buildMarketRecap>;
  raw: string | null;
  // Per-stage funnel counts so a 0-play outcome is self-diagnosing (which filter zeroed it)
  // without needing Railway logs. parsed → stock-only → within-premium-cap → strike-valid.
  funnel?: { parsed: number; stock: number; premium_ok: number; strike_ok: number };
}> {
  const recap = buildMarketRecap(params.ctx);
  const dossierMap = Object.fromEntries(params.dossiers.map((d) => [d.ticker, d]));

  if (!anthropicConfigured()) {
    const fallback = params.ranked.slice(0, 5).map((s, i) =>
      mapClaudePlayToEdition(
        {
          ticker: s.ticker,
          type: "stock",
          direction: s.direction === "long" ? "LONG" : "SHORT",
          conviction: s.conviction,
          key_signal: dossierMap[s.ticker]?.tech?.summary ?? "Mechanical fallback — Claude unavailable.",
          entry_range: "See technical levels",
          target: dossierMap[s.ticker]?.tech?.resistance_levels?.[0]?.toString() ?? "—",
          stop: dossierMap[s.ticker]?.tech?.support_levels?.[0]?.toString() ?? "—",
          options_play: "—",
          score: s.score,
        },
        i + 1,
        dossierMap
      )
    );
    return { plays: fallback, recap, raw: null };
  }

  const chainTickers = params.ranked.slice(0, EDITION_CHAIN_PREFETCH).map((s) => s.ticker);
  const chainData = await fetchEditionChains({ stockTickers: chainTickers, dossiers: params.dossiers });
  const chainTables = formatEditionChainTables(chainData);
  const chainRows = Object.fromEntries(Object.entries(chainData).map(([ticker, data]) => [ticker, data.rows]));

  const prompt = buildClaudePrompt({
    ctx: params.ctx,
    recap,
    dossiers: params.dossiers,
    ranked: params.ranked,
    chainTables,
    huntMode: params.huntMode,
    maxDte: params.maxDte,
    engineState: params.engineState,
    spxDesk: params.spxDesk ?? null,
    flowTape: params.flowTape ?? null,
    playOutcomes: params.playOutcomes ?? null,
  });
  // temperature:0 — structured JSON-array extraction (ranked plays), not prose;
  // deterministic output avoids nondeterminism + wasted retries on schema-constrained output.
  //
  // TIMEOUT (#77 — THE zeroing bug). This is the LARGEST generation in the codebase: 4500 output
  // tokens of structured JSON over a 12-dossier + chain-tables + full-market-context prompt. The
  // Anthropic client default is a 20s per-request timeout (see getClient() in providers/anthropic.ts),
  // which this generation routinely BLOWS PAST. With the default 3 retries, all three attempts time
  // out (~60s+ wall) and anthropicText returns null → generateEditionPlays returns 0 parsed plays →
  // the edition zeroes to recap-only. That is deterministic, market-independent, and explains why
  // 17/17 prior runs + tonight all produced 0 ranked plays despite candidates existing. The sibling
  // large generations already learned this: spx-commentary uses timeoutMs:45_000/maxRetries:1, the
  // NW narrative uses timeoutMs:20_000/maxRetries:1. The synthesis call — the biggest of all — never
  // got the fix. 90s gives a 4500-tok generation real headroom; maxRetries:1 avoids stacking 3×90s.
  const raw = await anthropicText(prompt, 4500, SYSTEM, {
    temperature: 0,
    timeoutMs: 90_000,
    maxRetries: 1,
  });
  if (!raw) {
    return { plays: [], recap, raw: null, funnel: { parsed: 0, stock: 0, premium_ok: 0, strike_ok: 0 } };
  }

  const parsed = parsePlaysJson(raw).slice(0, 8);
  const mapped = parsed
    .map((p, i) => mapClaudePlayToEdition(p, i + 1, dossierMap))
    .filter((p) => p.play_type === "stock");
  const { plays, rejected } = filterPlaysWithinPremiumCap(mapped);
  const strikeOk: PlaybookPlay[] = [];
  const strikeRejected: PlaybookPlay[] = [];
  for (const play of plays) {
    const rows = chainRows[play.ticker];
    // SOFT strike gate (#77). Only drop a play when the prefetched chain POSITIVELY contradicts it
    // (strike+expiry present in the ATM±5% front-two-expiry window but below the OI floor). A play
    // whose contract simply isn't in that narrow window — a longer-dated swing/leap, a slightly-OTM
    // strike, or a "weekly"/"0DTE" with no ISO date — is unverifiable, NOT contradicted, so it passes.
    // The old hard gate dropped every unverifiable play and zeroed whole editions (17 cands → 0 plays).
    if (!rows?.length || evaluatePlayAgainstChain(play.options_play, rows).ok) {
      strikeOk.push(play);
    } else {
      strikeRejected.push(play);
    }
  }
  if (strikeRejected.length) {
    console.warn(
      "[nighthawk/edition] strike validation rejected (chain-contradicted — illiquid strike):",
      strikeRejected.map((p) => `${p.ticker}: ${p.options_play.slice(0, 80)}`)
    );
  }
  const capped = strikeOk.slice(0, 5).map((p, i) => ({ ...p, rank: i + 1 }));

  if (rejected.length) {
    console.warn(
      "[nighthawk/edition] premium cap rejected:",
      rejected.map((p) => `${p.ticker} $${p.entry_premium ?? "?"}/sh`)
    );
  }

  return {
    plays: capped,
    recap,
    raw,
    funnel: { parsed: parsed.length, stock: mapped.length, premium_ok: plays.length, strike_ok: capped.length },
  };
}