import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import type { TickerDossier } from "./dossier";
import { buildClaudePrompt, buildMarketRecap, type EngineState } from "./format";
import type { MarketWideContext } from "./market-wide";
import type { SpxDeskSummary, FlowTapeSummary } from "@/lib/platform/types";
import type { PlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";
import {
  fetchEditionChains,
  formatEditionChainTables,
  evaluatePlayAgainstChain,
  augmentChainsWithExactContracts,
  parseOptionsContract,
  STRIKE_MIN_OI,
} from "./option-chain-prompt";
import {
  applyPremiumCapToPlay,
  filterPlaysWithinPremiumCap,
  type ClaudePlayRaw,
  validatePlayGeometry,
  capSectorConcentration,
  SECTOR_CONCENTRATION_MAX_PER_SECTOR,
} from "./play-constraints";
import {
  EDITION_CHAIN_PREFETCH,
  EDITION_SYNTHESIS_OVERSHOOT,
  GROUNDING_ENFORCE,
  MAX_OPTION_COST_PER_CONTRACT,
  MAX_OPTION_PREMIUM_PER_SHARE,
  PLAYBOOK_PREMIUM_CAP_LINE,
} from "./constants";
import { groundPlays, type GroundingSummary } from "./grounding";
import { buildDirectionalStockLevels } from "./play-levels";
import type { ScoredCandidate } from "./scorer";
import { convictionFromScore, convictionRank } from "./scorer";
import type { PlaybookPlay } from "./types";
import type { HuntMode } from "./types";
import type { NighthawkRejectionDetail } from "./play-outcomes";

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
  // SCORE PINNING (audit HIGH): the member-visible score is the DETERMINISTIC dossier
  // score, not the model's self-grade — Claude previously overrode it with play.score,
  // so a model that inflated its own number published it (and could disagree with the
  // critic-adjusted conviction on the same card). The model's number is only used when
  // no dossier score exists (mechanical fallback path, where it IS the deterministic
  // score passed through).
  const pinnedScore = dossier?.scored?.score ?? Number(play.score ?? 0);
  // Conviction: the more CONSERVATIVE of the model's letter and the deterministic
  // score→letter mapping. The model may legitimately grade below the math on
  // qualitative red flags (the critic's whole job); it may not grade above it.
  const modelConviction = String(play.conviction ?? "B");
  const deterministicConviction = convictionFromScore(pinnedScore);
  const conviction =
    convictionRank(modelConviction) < convictionRank(deterministicConviction)
      ? modelConviction
      : deterministicConviction;
  const scoredDirection = dossier?.scored?.direction;
  const modelDirection = String(play.direction ?? "LONG");
  if (
    scoredDirection &&
    (scoredDirection === "short") !== modelDirection.toUpperCase().includes("SHORT")
  ) {
    console.warn(
      `[nighthawk/edition] ${ticker}: model direction ${modelDirection} diverges from scored flow direction ${scoredDirection}`
    );
  }
  const base: PlaybookPlay = {
    rank,
    ticker,
    direction: modelDirection,
    conviction,
    play_type: playType === "index" ? "index" : playType === "etf" ? "etf" : "stock",
    thesis: String(play.key_signal ?? play.bias ?? ""),
    key_signal: String(play.key_signal ?? ""),
    entry_range: [play.entry_condition, play.entry_range].filter(Boolean).join(" | ") || "-",
    target: [play.target, play.target_note].filter(Boolean).join(" - ") || "-",
    stop: [play.stop, play.stop_note].filter(Boolean).join(" - ") || "-",
    options_play: String(play.options_play ?? "-"),
    risk_note: String(play.risk_note ?? ""),
    score: pinnedScore,
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
  // without needing Railway logs. parsed → stock-only → within-premium-cap → strike-valid → grounded.
  funnel?: {
    parsed: number;
    stock: number;
    /** Plays surviving the deterministic trade-geometry gate (entry/target/stop sanity). */
    geometry_ok: number;
    premium_ok: number;
    strike_ok: number;
    grounded: number;
    dropped_ungrounded: number;
    flagged: number;
  };
  // Numeric-grounding summary (audit P0) so the build can stamp grounded/dropped/flagged into meta.
  grounding?: GroundingSummary;
  // BIE Stage 4 audit trail (docs/bie/AUDIT-TRAIL-SCHEMA.md step 4b): plays that failed the
  // trade-geometry gate, with the full mapped play so the caller can build a real decision
  // trace — not just a ticker. Empty on the mechanical-fallback path (no geometry check runs
  // there) and on a zero-parsed-plays exit (nothing was ever mapped to check).
  // `scored` (task #142): the SAME ScoredCandidate scoreCandidate() computed for this ticker
  // this run — dossierMap[ticker].scored, the identical object mapClaudePlayToEdition already
  // reads above for pinnedScore/scoredDirection — so the rejection audit row can explain the
  // desk's confluence read on the name, not just the failed target/stop geometry. null only
  // when this ticker never had a matching dossier this run (mechanical-fallback path, or a
  // ticker Claude named outside the scored candidate set). See the push site below for why
  // this reads the in-memory dossier rather than nighthawk_scoring_history (task #129): that
  // table is only archived AFTER this function returns (edition-builder.ts's
  // archiveAndClearNighthawkStaging runs post-publish), so a DB read here would find nothing
  // for tonight's edition.
  geometryRejected?: Array<{ ticker: string; drops: string[]; play: PlaybookPlay; scored: ScoredCandidate | null }>;
  // task #141: plays rejected at any of the 3 LATER funnel stages that run strictly after the
  // geometry gate above — premium-cap (filterPlaysWithinPremiumCap), illiquid-strike (the
  // chain-contradicted OI loop), and ungrounded (groundPlays' HARD drops) — PLUS
  // sector-concentration (capSectorConcentration), which runs last in this same function.
  // Combined into one array (vs. 3-4 separate fields) because the caller (edition-builder.ts)
  // treats them identically: one fire-and-forget durable audit row per entry, same as
  // geometryRejected above. Empty on the same early-exit paths geometryRejected is empty on.
  // `scored` (task #142): same in-memory confluence breakdown as geometryRejected's `scored`
  // — every one of the 4 later-stage push sites below runs on a play still backed by the same
  // dossierMap this function built at the top, so the same lookup applies uniformly.
  stageRejected?: Array<{ ticker: string; play: PlaybookPlay; detail: NighthawkRejectionDetail; scored: ScoredCandidate | null }>;
}> {
  const recap = buildMarketRecap(params.ctx);
  const dossierMap = Object.fromEntries(params.dossiers.map((d) => [d.ticker, d]));

  if (!anthropicConfigured()) {
    const fallback = params.ranked.slice(0, 5).map((s, i) => {
      const dossier = dossierMap[s.ticker];
      const levels = buildDirectionalStockLevels({
        direction: s.direction,
        support: dossier?.tech?.support_levels?.[0],
        resistance: dossier?.tech?.resistance_levels?.[0],
      });
      return mapClaudePlayToEdition(
        {
          ticker: s.ticker,
          type: "stock",
          direction: s.direction === "long" ? "LONG" : "SHORT",
          conviction: s.conviction,
          key_signal: dossier?.tech?.summary ?? "Mechanical fallback — Claude unavailable.",
          entry_range: levels.entry_range,
          target: levels.target,
          stop: levels.stop,
          options_play: "-",
          score: s.score,
        },
        i + 1,
        dossierMap
      );
    });
    return { plays: fallback, recap, raw: null };
  }

  const chainTickers = params.ranked.slice(0, EDITION_CHAIN_PREFETCH).map((s) => s.ticker);
  let chainData = await fetchEditionChains({ stockTickers: chainTickers, dossiers: params.dossiers });
  const chainTables = formatEditionChainTables(chainData);

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
    return {
      plays: [],
      recap,
      raw: null,
      funnel: { parsed: 0, stock: 0, geometry_ok: 0, premium_ok: 0, strike_ok: 0, grounded: 0, dropped_ungrounded: 0, flagged: 0 },
    };
  }

  const parsed = parsePlaysJson(raw).slice(0, EDITION_SYNTHESIS_OVERSHOOT + 1);
  const mappedAll = parsed
    .map((p, i) => mapClaudePlayToEdition(p, i + 1, dossierMap))
    .filter((p) => p.play_type === "stock");
  // TRADE-GEOMETRY GATE (audit HIGH): entry/target/stop are the numbers members act
  // on, and nothing in the publish path validated them — a target and stop on the
  // same side of entry, or the corrupt entry-range class (#207), published intact.
  // Validated with the SAME parser the outcome grader uses, so publish-time truth
  // and grading truth cannot diverge.
  const mapped: typeof mappedAll = [];
  const geometryRejected: Array<{ ticker: string; drops: string[]; play: PlaybookPlay; scored: ScoredCandidate | null }> = [];
  for (const play of mappedAll) {
    const verdict = validatePlayGeometry(play);
    if (verdict.ok) {
      mapped.push(play);
      if (verdict.flags.length) {
        console.warn(`[nighthawk/geometry] ${play.ticker} flagged: ${verdict.flags.join("; ")}`);
      }
    } else {
      // task #142: dossierMap[play.ticker]?.scored is the SAME ScoredCandidate object read
      // above (line ~70/80) for pinnedScore/scoredDirection — reusing it here, in memory,
      // rather than a nighthawk_scoring_history DB lookup, which would find nothing for
      // tonight's edition (that table only gets archived post-publish, well after this
      // function returns — see edition-builder.ts's archiveAndClearNighthawkStaging).
      geometryRejected.push({ ticker: play.ticker, drops: verdict.drops, play, scored: dossierMap[play.ticker]?.scored ?? null });
    }
  }
  if (geometryRejected.length) {
    console.warn(
      "[nighthawk/geometry] rejected (untradeable risk plan):",
      geometryRejected.map((r) => `${r.ticker}: ${r.drops.join("; ")}`)
    );
  }
  const { plays, rejected } = filterPlaysWithinPremiumCap(mapped);
  // task #141: durable audit rows for every later-funnel rejection stage, accumulated as we go
  // and returned to the caller (edition-builder.ts, which owns editionFor) alongside
  // geometryRejected above. Populated below as premium-cap / illiquid-strike / ungrounded /
  // sector-concentration each run; never fabricated — every entry mirrors a real drop that
  // already happened via the pre-existing console.warn logging on the same variables.
  const stageRejected: Array<{ ticker: string; play: PlaybookPlay; detail: NighthawkRejectionDetail; scored: ScoredCandidate | null }> = [];
  for (const p of rejected) {
    stageRejected.push({
      ticker: p.ticker,
      play: p,
      detail: {
        stage: "premium_cap",
        entry_premium: p.entry_premium ?? null,
        cap_per_share: MAX_OPTION_PREMIUM_PER_SHARE,
        entry_cost_per_contract: p.entry_cost_per_contract ?? null,
        cap_per_contract: MAX_OPTION_COST_PER_CONTRACT,
      },
      // task #142: same in-memory confluence breakdown as geometryRejected above.
      scored: dossierMap[p.ticker]?.scored ?? null,
    });
  }
  chainData = await augmentChainsWithExactContracts({ plays, chains: chainData });
  const chainRows = Object.fromEntries(Object.entries(chainData).map(([ticker, data]) => [ticker, data.rows]));
  const strikeOk: PlaybookPlay[] = [];
  const strikeRejected: PlaybookPlay[] = [];
  for (const play of plays) {
    const rows = chainRows[play.ticker];
    // SOFT early strike gate (#77). Only drop here when the prompt's narrow ATM/front-expiry chain
    // POSITIVELY contradicts the play (present but below the OI floor). Missing rows pass only to the
    // exact-contract grounding step below; they are NOT allowed to publish unless the exact snapshot
    // confirms the contract and reconciles the premium.
    if (!rows?.length) {
      strikeOk.push(play);
      continue;
    }
    const verdict = evaluatePlayAgainstChain(play.options_play, rows);
    if (verdict.ok) {
      strikeOk.push(play);
    } else {
      strikeRejected.push(play);
      // task #141: same verdict/rows the console.warn below already summarizes, plus the
      // parsed contract (strike/side/expiry) so the audit row can cite the actual liquidity
      // number (verdict.matchedOi) that failed the floor, not just "illiquid".
      const parsedContract = parseOptionsContract(play.options_play);
      stageRejected.push({
        ticker: play.ticker,
        play,
        detail: {
          stage: "illiquid_strike",
          strike: parsedContract?.strike ?? null,
          side: parsedContract?.side ?? null,
          expiry: parsedContract?.expiryYmd ?? null,
          open_interest: verdict.matchedOi,
          min_open_interest: STRIKE_MIN_OI,
        },
        // task #142: same in-memory confluence breakdown as geometryRejected above.
        scored: dossierMap[play.ticker]?.scored ?? null,
      });
    }
  }
  if (strikeRejected.length) {
    console.warn(
      "[nighthawk/edition] strike validation rejected (chain-contradicted — illiquid strike):",
      strikeRejected.map((p) => `${p.ticker}: ${p.options_play.slice(0, 80)}`)
    );
  }
  // NUMERIC-GROUNDING ENFORCEMENT (audit P0). Deterministic arithmetic grounding of each play
  // against the SAME prefetched chain plus the exact per-contract snapshots added above. HARD
  // failures (unmatched exact contract, illiquid strike, null/way-off premium vs live snapshot) DROP
  // the play; SOFT issues (flow/level/prose/PT divergence) keep the play but strip/flag the number.
  // Run on the FULL strikeOk list BEFORE the top-5 slice so a dropped play lets a lower-ranked
  // grounded play fill its slot.
  const { plays: groundedPlays, summary: grounding, dropped: ungroundedDropped } = groundPlays(
    strikeOk,
    chainData,
    dossierMap
  );
  // task #141: one audit-row detail per HARD-dropped play, citing the SAME drop-severity
  // issues (check + human-readable detail — e.g. "strike ... OI 320 < 500" or "target $x does
  // not trace to any dossier S/R or chain strike") that groundPlays() already logged via
  // console.warn and folded into grounding.notes above.
  for (const d of ungroundedDropped) {
    stageRejected.push({
      ticker: d.ticker,
      play: d.play,
      detail: { stage: "ungrounded", issues: d.issues.map((i) => ({ check: i.check, detail: i.detail })) },
      // task #142: same in-memory confluence breakdown as geometryRejected above.
      scored: dossierMap[d.ticker]?.scored ?? null,
    });
  }

  // The flag only controls whether HARD drops take effect — the checks + summary always run/log.
  // When enforcement is OFF we keep strikeOk (so output is unchanged) but still emit the summary so a
  // dry-run shows exactly what WOULD have dropped.
  const postGrounding = GROUNDING_ENFORCE
    ? groundedPlays
    : strikeOk.map((p, i) => ({ ...p, rank: i + 1 }));
  if (grounding.notes.length) {
    console.warn(
      `[nighthawk/grounding] summary (enforce=${GROUNDING_ENFORCE ? "on" : "off"}): ` +
        `grounded=${grounding.grounded}, dropped_ungrounded=${grounding.dropped_ungrounded}, flagged=${grounding.flagged}`
    );
  }

  // SECTOR CONCENTRATION CAP (audit MEDIUM): nothing stopped the whole book being
  // five correlated same-sector longs. Applied BEFORE the overshoot slice so a
  // lower-ranked play from another sector backfills the freed slot.
  const sectorByTicker = Object.fromEntries(
    params.dossiers.map((d) => [d.ticker.toUpperCase(), d.sector ?? null])
  );
  const sectorCap = capSectorConcentration(postGrounding, sectorByTicker);
  if (sectorCap.dropped.length) {
    console.warn(
      "[nighthawk/edition] sector-concentration cap dropped:",
      sectorCap.dropped.map((d) => `${d.ticker} (${d.sector})`)
    );
  }
  // task #141: sectorCap.dropped's `filled`/`play` fields (added alongside this task) answer
  // "how many other tickers already filled this sector" without re-deriving it here.
  for (const d of sectorCap.dropped) {
    stageRejected.push({
      ticker: d.ticker,
      play: d.play,
      detail: {
        stage: "sector_concentration",
        sector: d.sector,
        already_filled: d.filled,
        max_per_sector: SECTOR_CONCENTRATION_MAX_PER_SECTOR,
      },
      // task #142: same in-memory confluence breakdown as geometryRejected above.
      scored: dossierMap[d.ticker]?.scored ?? null,
    });
  }
  const capped = sectorCap.plays.slice(0, EDITION_SYNTHESIS_OVERSHOOT).map((p, i) => ({ ...p, rank: i + 1 }));

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
    geometryRejected,
    stageRejected,
    funnel: {
      parsed: parsed.length,
      stock: mappedAll.length,
      geometry_ok: mapped.length,
      premium_ok: plays.length,
      strike_ok: strikeOk.length,
      grounded: grounding.grounded,
      dropped_ungrounded: grounding.dropped_ungrounded,
      flagged: grounding.flagged,
    },
    grounding,
  };
}