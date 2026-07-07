import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import type { TickerDossier } from "./dossier";
import { buildMarketRecap, formatTickerDossierText } from "./format";
import type { MarketWideContext } from "./market-wide";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";
import { checkNumbersGrounded, extractNumbersFromText } from "@/lib/grounding-guard";

const SYSTEM = `You are a skeptical options risk manager reviewing a playbook before publication. Output ONLY a valid JSON array. No markdown fences.

For each play in the input list, output one object:
{ "rank": <original rank>, "verdict": "keep"|"downgrade"|"cut", "reason": "<brief reason>", "corrected_conviction": "A+"|"A"|"B"|"C" }

Verify each play for:
- Flow direction matches thesis and play direction
- Entry/target/stop use real levels from dossier data (not fabricated)
- No contradiction with risk reversal skew
- At least 2 confirming signals from dossier
- Alignment with current market regime (tide, VIX IV rank)

Be skeptical. Cut weak or contradictory plays. Downgrade inflated conviction.`;

type CriticVerdict = {
  rank: number;
  verdict: "keep" | "downgrade" | "cut";
  reason: string;
  corrected_conviction: string;
};

function parseCriticJson(raw: string): CriticVerdict[] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as CriticVerdict[];
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as CriticVerdict[];
  } catch {
    return [];
  }
}

function scoredForPlay(
  play: PlaybookPlay,
  dossiers: Record<string, TickerDossier>,
  ranked: ScoredCandidate[]
): ScoredCandidate | undefined {
  const fromRanked = ranked.find((r) => r.ticker.toUpperCase() === play.ticker.toUpperCase());
  if (fromRanked) return fromRanked;
  const dossier = dossiers[play.ticker.toUpperCase()];
  return dossier?.scored;
}

export async function critiquePlays(params: {
  plays: PlaybookPlay[];
  dossiers: Record<string, TickerDossier>;
  ranked: ScoredCandidate[];
  ctx: MarketWideContext;
}): Promise<{ plays: PlaybookPlay[]; notes: string[] }> {
  const { plays, dossiers, ranked, ctx } = params;
  if (!anthropicConfigured() || !plays.length) {
    return { plays, notes: [] };
  }

  const recap = buildMarketRecap(ctx);
  const promptParts: string[] = [
    "MARKET REGIME",
    recap.summary,
    `Tide: ${recap.tide}`,
    `VIX IV rank: ${ctx.vix_iv_rank ?? "unknown"}`,
    "",
    "PLAYS TO REVIEW",
  ];

  // Per-play known-good text, captured so the critic's reason for THIS play can be grounded
  // against exactly what THIS play's block showed Claude — not the whole batch's prompt (a
  // reason for play #3 citing a number that only appears in play #7's block is still
  // ungrounded for #3, even though the string technically appears somewhere in the prompt).
  const knownTextByRank = new Map<number, string>();

  for (const play of plays) {
    const scored = scoredForPlay(play, dossiers, ranked);
    const dossier = dossiers[play.ticker.toUpperCase()];
    const playLines: string[] = [
      `--- Play #${play.rank}: ${play.ticker} ${play.direction} (${play.conviction}) ---`,
      `Thesis: ${play.thesis || play.key_signal}`,
      `Entry: ${play.entry_range}`,
      `Target: ${play.target}`,
      `Stop: ${play.stop}`,
      `Options: ${play.options_play}`,
    ];
    if (dossier && scored) {
      playLines.push("", formatTickerDossierText(dossier, scored));
    }
    knownTextByRank.set(play.rank, playLines.join("\n"));
    promptParts.push(...playLines, "");
  }

  // temperature:0 — structured JSON-array extraction (per-play keep/downgrade/cut verdicts),
  // not prose; deterministic output avoids nondeterminism + wasted retries on schema-constrained output.
  //
  // TIMEOUT (#77). 3000 output tokens over a per-play dossier prompt also blows past the 20s client
  // default; on timeout anthropicText returns null. Here that FAILS OPEN (the !raw branch returns the
  // input plays unchanged), so a critic timeout does NOT zero the funnel — but it silently skips the
  // quality review. Give it the same headroom as synthesis so the critic actually runs.
  const raw = await anthropicText(promptParts.join("\n"), 3000, SYSTEM, {
    temperature: 0,
    timeoutMs: 60_000,
    maxRetries: 1,
  });
  if (!raw) {
    return { plays, notes: [] };
  }

  const verdicts = parseCriticJson(raw);
  if (!verdicts.length) {
    return { plays, notes: [] };
  }

  const notes: string[] = [];
  const verdictByRank = new Map(verdicts.map((v) => [Number(v.rank), v]));
  const surviving: PlaybookPlay[] = [];

  for (const play of plays) {
    const verdict = verdictByRank.get(play.rank);
    if (!verdict) {
      surviving.push(play);
      continue;
    }

    // FABRICATION GUARD: the critic cuts/downgrades a play based solely on Claude's
    // self-reported "reason" with no check that the cited contradiction is real. Ground the
    // reason against exactly what THIS play's own block showed Claude ("keep" verdicts have
    // no consequence, so only cut/downgrade need gating). An unverified reason must not be
    // allowed to silently zero or demote a play — reject the verdict and keep the play as-is.
    if (verdict.verdict !== "keep" && verdict.reason) {
      const known = extractNumbersFromText(knownTextByRank.get(play.rank) ?? "");
      const grounding = checkNumbersGrounded(verdict.reason, known);
      if (!grounding.grounded) {
        console.warn(
          `[nighthawk/play-critic] ungrounded value ${grounding.ungroundedValue} in critic reason for #${play.rank} ${play.ticker} — verdict rejected, play kept unchanged.`
        );
        notes.push(
          `#${play.rank} ${play.ticker}: verdict REJECTED (reason cited an unverified level) — play kept unchanged.`
        );
        surviving.push(play);
        continue;
      }
    }

    notes.push(`#${play.rank} ${play.ticker}: ${verdict.verdict} — ${verdict.reason}`);

    if (verdict.verdict === "cut") {
      continue;
    }

    if (verdict.verdict === "downgrade") {
      surviving.push({
        ...play,
        conviction: verdict.corrected_conviction || play.conviction,
      });
    } else {
      surviving.push(play);
    }
  }

  if (surviving.length < plays.length) {
    notes.push(
      `Publishing ${surviving.length} vetted play(s) — ${plays.length - surviving.length} cut (no mechanical backfill; fewer strong plays beats stub contracts).`
    );
  }

  const reranked = surviving.map((p, i) => ({ ...p, rank: i + 1 }));
  return { plays: reranked, notes };
}
