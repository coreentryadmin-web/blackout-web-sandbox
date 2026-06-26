import {
  upsertNighthawkEdition,
  dbConfigured,
  clearNighthawkStaging,
  fetchNighthawkEditionByDate,
  fetchNighthawkJob,
  fetchStagedDossierTickers,
  fetchStagedDossiers,
  logNighthawkJob,
  saveDossierStaging,
  upsertNighthawkJob,
} from "@/lib/db";
import { marketPlatform } from "@/lib/platform";
import { uwConfigured } from "@/lib/providers/config";
import { polygonConfigured } from "@/lib/providers/config";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { syncNighthawkPlayOutcomes } from "./play-outcomes";
import { extractCandidateTickers } from "./candidates";
import { fetchAllDossiers, resetEditionCongressCache, type TickerDossier } from "./dossier";
import { generateEditionPlays } from "./claude-edition";
import { fetchPlayOutcomeStats } from "@/lib/spx-play-outcomes";
import { buildMarketRecap, formatTickerDossierText } from "./format";
import { fetchIndexDossiers } from "./index-dossier";
import { fetchMarketWideContext, type MarketWideContext } from "./market-wide";
import { critiquePlays } from "./play-critic";
import { rankCandidates, regimeContextFromMarket, type ScoredCandidate } from "./scorer";
import { DOSSIER_BATCH_SIZE, EDITION_SYNTHESIS_POOL, MAX_CANDIDATES, MAX_DOSSIER_STOCKS } from "./constants";
import { nextTradingDayEt, todayEt } from "./session";
import type { NightHawkEdition, PlaybookPlay } from "./types";

export type EditionBuildResult = {
  ok: boolean;
  edition_for: string;
  plays_count: number;
  candidates: number;
  error?: string;
  duration_ms: number;
  job_status?: string;
  current_stage?: string | null;
  resumed?: boolean;
  /** True when a real edition row was published with a recap but plays:[] (no plays survived the funnel). */
  recap_only?: boolean;
};

function stagedToDossierMap(
  staged: Awaited<ReturnType<typeof fetchStagedDossiers>>
): Record<string, TickerDossier> {
  const out: Record<string, TickerDossier> = {};
  for (const row of staged) {
    const dossier = row.dossier as TickerDossier;
    if (row.scored) dossier.scored = row.scored as ScoredCandidate;
    out[row.ticker] = dossier;
  }
  return out;
}

/** Serialize a thrown value to a USEFUL message. A non-Error throw (a provider/SDK error object, a
 *  Promise.reject(obj), a fetch-response-shaped reject) otherwise becomes the useless "[object Object]"
 *  in job.error — which is exactly what hid the real edition-build failure from admin/#77. Prefer a
 *  .message/.error/.detail field, else a bounded JSON dump, so the next failure is diagnosable. */
function serializeBuildError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (error && typeof error === "object") {
    const o = error as Record<string, unknown>;
    for (const k of ["message", "error", "detail", "reason"] as const) {
      if (typeof o[k] === "string" && o[k]) return String(o[k]);
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json.slice(0, 500);
    } catch {
      /* circular — fall through to String() */
    }
  }
  return String(error);
}

/**
 * RECAP-ONLY FALLBACK (audit P0 / #77). When the candidate→play funnel legitimately collapses to
 * zero (no flow candidates, no scored dossiers, all candidates fundamentally blocked, Claude/critic
 * returns nothing), we STILL publish a real edition row — a genuine market recap with `plays: []` —
 * and mark the job `published` instead of `failed`. This is what guarantees the UI shows a recap
 * instead of a perpetual "being built" state. It NEVER fabricates plays.
 *
 * The recap is deterministic from `ctx` (already fetched at stage_context), so it is always available
 * once we are past the API-key guard. `reason` records WHICH funnel stage zeroed so the empty state is
 * self-explaining in meta. Idempotent: upsert keys on edition_for, job flips to published, staging cleared.
 */
async function publishRecapOnlyEdition(params: {
  editionFor: string;
  ctx: MarketWideContext;
  reason: string;
  candidates: number;
  checkpointing: boolean;
  force: boolean;
}): Promise<void> {
  const { editionFor, ctx, reason, candidates, checkpointing, force } = params;
  const recap = buildMarketRecap(ctx);

  // Best-effort enrich the recap with index context + desk/tape so the recap-only edition is still a
  // useful market read, not a bare headline. All optional — never let an enrichment failure block the
  // guaranteed row write.
  const [indexDossiers, spxDesk, flowTape] = await Promise.all([
    fetchIndexDossiers(ctx).catch(() => []),
    marketPlatform.spx.getSpxDeskSummary().catch(() => null),
    marketPlatform.flows.getFlowTapeSummary({ limit: 30 }).catch(() => null),
  ]);

  await upsertNighthawkEdition({
    edition_for: editionFor,
    session_date: ctx.today,
    recap_headline: recap.headline,
    recap_summary: recap.summary,
    market_recap: {
      tide: recap.tide,
      spx_vix: recap.spx_vix,
      sector_strength: recap.sector_strength,
      sector_weakness: recap.sector_weakness,
      catalysts: recap.catalysts,
      hot_chains: ctx.hot_chains.slice(0, 10),
      sector_tides: ctx.sector_tides,
      index_flows: ctx.index_flows,
      top_net_impact: ctx.top_net_impact.slice(0, 10),
      vix_iv_rank: ctx.vix_iv_rank,
      vix_term: ctx.vix_term,
      index_dossiers: indexDossiers,
      spx_desk: spxDesk,
      flow_tape: flowTape,
    },
    plays: [],
    meta: {
      candidates,
      ranked_tickers: [],
      claude: false,
      recap_only: true,
      recap_only_reason: reason,
      built_at: new Date().toISOString(),
      force,
      play_explanations: {},
      critic_notes: [],
      critic_applied: false,
      platform: {
        spx_price: spxDesk?.price ?? null,
        spx_regime: spxDesk?.gamma_regime ?? null,
        flow_alert_count: flowTape?.count ?? null,
      },
    },
  });

  if (checkpointing) {
    await upsertNighthawkJob(editionFor, {
      status: "published",
      current_stage: "published",
      published_at: new Date().toISOString(),
      error: null,
    });
    await clearNighthawkStaging(editionFor);
    logNighthawkJob(editionFor, "info", "published", `Recap-only edition published (no plays) — ${reason}`);
  }
}

export async function buildEveningEdition(opts?: {
  force?: boolean;
}): Promise<EditionBuildResult> {
  const started = Date.now();
  const editionFor = nextTradingDayEt(todayEt());
  const checkpointing = dbConfigured();

  if (!uwConfigured() && !polygonConfigured()) {
    return {
      ok: false,
      edition_for: editionFor,
      plays_count: 0,
      candidates: 0,
      error: "No market data API keys configured (UW or Polygon required).",
      duration_ms: Date.now() - started,
    };
  }

  let job = checkpointing ? await fetchNighthawkJob(editionFor) : null;

  if (job?.status === "published" && opts?.force) {
    await clearNighthawkStaging(editionFor);
    await upsertNighthawkJob(editionFor, {
      status: "running",
      current_stage: "stage_context",
      context_json: null,
      candidates_json: null,
      scored_json: null,
      synthesis_json: null,
      error: null,
      published_at: null,
    });
    job = await fetchNighthawkJob(editionFor);
    logNighthawkJob(editionFor, "info", null, "Force rebuild — job reset");
  } else if (job?.status === "published" && !opts?.force) {
    const existing = await fetchNighthawkEditionByDate(editionFor);
    return {
      ok: true,
      edition_for: editionFor,
      plays_count: existing?.plays?.length ?? 0,
      candidates: job.candidates_json?.length ?? 0,
      duration_ms: Date.now() - started,
      job_status: job.status,
      current_stage: job.current_stage,
      resumed: true,
    };
  }

  try {
    if (checkpointing) {
      if (!job) {
        await upsertNighthawkJob(editionFor, { status: "running", current_stage: "stage_context" });
        job = await fetchNighthawkJob(editionFor);
        logNighthawkJob(editionFor, "info", "stage_context", "Job created");
      } else if (job.status === "failed") {
        await upsertNighthawkJob(editionFor, { status: "running", error: null, current_stage: job.current_stage ?? "stage_context" });
        logNighthawkJob(editionFor, "info", job.current_stage, "Resuming failed job");
      }
    }

    // STAGE 1 — Market context
    let ctx = (job?.context_json as MarketWideContext | null) ?? null;
    if (!ctx) {
      if (checkpointing) await upsertNighthawkJob(editionFor, { status: "running", current_stage: "stage_context" });
      console.info("[nighthawk/edition] stage_context: market-wide context");
      ctx = await fetchMarketWideContext();
      if (checkpointing) {
        await upsertNighthawkJob(editionFor, {
          context_json: ctx as unknown as Record<string, unknown>,
          status: "stage_context",
          current_stage: "stage_candidates",
        });
        logNighthawkJob(editionFor, "info", "stage_context", "Market context built");
      }
    } else {
      console.info("[nighthawk/edition] stage_context: loaded from checkpoint");
    }

    // STAGE 2 — Candidates
    let candidates = job?.candidates_json ?? null;
    if (!candidates?.length) {
      if (checkpointing) await upsertNighthawkJob(editionFor, { status: "running", current_stage: "stage_candidates" });
      console.info("[nighthawk/edition] stage_candidates: selection");
      candidates = await extractCandidateTickers(ctx.stock_flows, ctx.hot_chains, MAX_CANDIDATES);
      if (!candidates.length) {
        // Funnel collapsed at stage_candidates — the flow feed was genuinely empty (thin tape, or UW
        // returned nothing). Do NOT leave the UI "being built": publish a recap-only edition.
        const reason = `No flow candidates (stock_flows ${ctx.stock_flows.length}, hot_chains ${ctx.hot_chains.length}).`;
        console.warn(`[nighthawk/edition] stage_candidates zeroed — recap-only fallback: ${reason}`);
        await publishRecapOnlyEdition({ editionFor, ctx, reason, candidates: 0, checkpointing, force: Boolean(opts?.force) });
        return {
          ok: true,
          edition_for: editionFor,
          plays_count: 0,
          candidates: 0,
          recap_only: true,
          duration_ms: Date.now() - started,
          job_status: "published",
          current_stage: "published",
        };
      }
      if (checkpointing) {
        await upsertNighthawkJob(editionFor, {
          candidates_json: candidates,
          status: "stage_candidates",
          current_stage: "stage_dossiers",
        });
        logNighthawkJob(editionFor, "info", "stage_candidates", `Selected ${candidates.length} candidates`);
      }
    } else {
      console.info(`[nighthawk/edition] stage_candidates: loaded ${candidates.length} from checkpoint`);
    }

    // STAGE 3 — Dossiers (resume-aware)
    resetEditionCongressCache();
    const regime = regimeContextFromMarket(ctx);
    const alreadyDone = checkpointing ? await fetchStagedDossierTickers(editionFor) : [];
    const remaining = candidates.filter((t) => !alreadyDone.includes(t.toUpperCase()));

    let dossiers: Record<string, TickerDossier>;

    if (checkpointing) {
      if (remaining.length) {
        await upsertNighthawkJob(editionFor, { status: "running", current_stage: "stage_dossiers" });
        console.info(`[nighthawk/edition] stage_dossiers: ${remaining.length} remaining (${alreadyDone.length} staged)`);

        let completed = alreadyDone.length;
        const total = candidates.length;

        await fetchAllDossiers(remaining, DOSSIER_BATCH_SIZE, regime, async (dossier) => {
          completed += 1;
          await saveDossierStaging(
            editionFor,
            dossier.ticker,
            dossier as unknown as Record<string, unknown>,
            dossier.scored as unknown as Record<string, unknown> | undefined
          );
          logNighthawkJob(
            editionFor,
            "info",
            "stage_dossiers",
            `Dossier ${dossier.ticker} done (${completed}/${total})`
          );
        });
      }

      dossiers = stagedToDossierMap(await fetchStagedDossiers(editionFor));
    } else {
      console.info(`[nighthawk/edition] dossiers for ${candidates.length} tickers (no checkpointing)`);
      dossiers = await fetchAllDossiers(candidates, DOSSIER_BATCH_SIZE, regime);
    }

    const scoredList = Object.values(dossiers)
      .filter((d) => d.scored != null)
      .map((d) => d.scored!);

    if (!scoredList.length) {
      // Funnel collapsed at stage_dossiers — candidates existed but none produced a scored dossier
      // (dossier fetch/scoring failures). Publish a recap-only edition rather than failing dark.
      const reason = `No scored dossiers after staging (${candidates.length} candidate(s)).`;
      console.warn(`[nighthawk/edition] stage_dossiers zeroed — recap-only fallback: ${reason}`);
      await publishRecapOnlyEdition({ editionFor, ctx, reason, candidates: candidates.length, checkpointing, force: Boolean(opts?.force) });
      return {
        ok: true,
        edition_for: editionFor,
        plays_count: 0,
        candidates: candidates.length,
        recap_only: true,
        duration_ms: Date.now() - started,
        job_status: "published",
        current_stage: "published",
      };
    }

    // STAGE 4 — Ranking (resume-aware: reuse checkpointed scored_json)
    const checkpointedRanked =
      checkpointing && Array.isArray(job?.scored_json) && job.scored_json.length
        ? (job.scored_json as ScoredCandidate[])
        : null;
    let ranked: ScoredCandidate[];
    if (checkpointedRanked) {
      ranked = checkpointedRanked;
      console.info(`[nighthawk/edition] stage_scoring: loaded ${ranked.length} ranked from checkpoint`);
    } else {
      const { ranked: freshRanked, exclusionReason: rankExclusionReason } = rankCandidates(scoredList, MAX_DOSSIER_STOCKS);
      ranked = freshRanked;
      // Over-strict-filter rescue: rankCandidates drops EVERY candidate flagged fundamental_block.
      // If that zeroes the pool while non-halted candidates exist, fall back to ranking those
      // (halts stay excluded — you cannot trade a halted name). This keeps a genuine flow feed from
      // silently collapsing to 0 plays just because mega-cap P/E etc. tripped the fundamental sanity
      // gate. Claude + the critic still vet each play downstream.
      if (!ranked.length) {
        const tradable = scoredList.filter((c) => !c.trading_halt);
        if (tradable.length) {
          ranked = [...tradable].sort((a, b) => b.score - a.score).slice(0, MAX_DOSSIER_STOCKS);
          console.warn(
            `[nighthawk/edition] stage_scoring rescue — fundamental filter zeroed ranking; ranking ${ranked.length} non-halted candidate(s) instead.${rankExclusionReason ? ` (${rankExclusionReason})` : ""}`
          );
        }
      }
      if (checkpointing) {
        await upsertNighthawkJob(editionFor, {
          scored_json: ranked,
          status: "stage_scoring",
          current_stage: "stage_synthesis",
        });
        logNighthawkJob(editionFor, "info", "stage_scoring", `Ranked ${ranked.length} tickers for synthesis${rankExclusionReason ? ` — ${rankExclusionReason}` : ""}`);
      }
    }

    const topDossiers = ranked.map((s) => dossiers[s.ticker]).filter(Boolean);
    const synthesisRanked = ranked.slice(0, EDITION_SYNTHESIS_POOL);
    const synthesisDossiers = synthesisRanked.map((s) => dossiers[s.ticker]).filter(Boolean);

    if (!synthesisDossiers.length) {
      // Nothing survived to synthesis (e.g. every candidate halted, or ranking empty after rescue).
      // A Claude call with no dossiers can only return nothing — short-circuit to recap-only so a
      // real published row is written instead of failing through the synthesis path.
      const reason = `No dossiers to synthesize (${candidates.length} candidate(s), 0 ranked).`;
      console.warn(`[nighthawk/edition] stage_synthesis pre-empty — recap-only fallback: ${reason}`);
      await publishRecapOnlyEdition({ editionFor, ctx, reason, candidates: candidates.length, checkpointing, force: Boolean(opts?.force) });
      return {
        ok: true,
        edition_for: editionFor,
        plays_count: 0,
        candidates: candidates.length,
        recap_only: true,
        duration_ms: Date.now() - started,
        job_status: "published",
        current_stage: "published",
      };
    }

    // Index context for recap only
    console.info("[nighthawk/edition] stage_synthesis: index recap + Claude");
    const [indexDossiers, spxDesk, flowTape, spxPlay, spxOpenPlay, spxLotto, spxPowerHour, playOutcomes] = await Promise.all([
      fetchIndexDossiers(ctx),
      marketPlatform.spx.getSpxDeskSummary().catch(() => null),
      marketPlatform.flows.getFlowTapeSummary({ limit: 30 }).catch(() => null),
      marketPlatform.spx.getSpxPlayState().catch(() => null),
      marketPlatform.spx.getSpxOpenPlay().catch(() => null),
      marketPlatform.spx.getSpxLottoState().catch(() => []),
      marketPlatform.spx.getSpxPowerHourState().catch(() => null),
      fetchPlayOutcomeStats().catch(() => null),
    ]);
    const engineState = {
      play: spxPlay,
      openPlay: spxOpenPlay?.open_play ?? null,
      lotto: spxLotto ?? [],
      powerHour: spxPowerHour ?? null,
    };

    // recap is deterministic from ctx — safe to rebuild on resume.
    const recap = buildMarketRecap(ctx);

    // STAGE 5 — Synthesis + critic (resume-aware: reuse checkpointed Claude output)
    type SynthesisCheckpoint = { plays: PlaybookPlay[]; critic_notes: string[]; claude: boolean };
    const checkpointedSynthesis =
      checkpointing && job?.synthesis_json
        ? (job.synthesis_json as unknown as SynthesisCheckpoint)
        : null;

    let finalPlays: PlaybookPlay[];
    let finalCriticNotes: string[];
    let raw: string | null;

    if (checkpointedSynthesis && Array.isArray(checkpointedSynthesis.plays) && checkpointedSynthesis.plays.length) {
      finalPlays = checkpointedSynthesis.plays;
      finalCriticNotes = Array.isArray(checkpointedSynthesis.critic_notes) ? checkpointedSynthesis.critic_notes : [];
      raw = checkpointedSynthesis.claude ? "checkpointed" : null;
      console.info(`[nighthawk/edition] stage_synthesis: loaded ${finalPlays.length} vetted plays from checkpoint`);
    } else {
      const { plays: rawPlays, raw: synthRaw, funnel } = await generateEditionPlays({
        ctx,
        dossiers: synthesisDossiers,
        ranked: synthesisRanked,
        engineState,
        spxDesk,
        flowTape,
        playOutcomes,
      });
      raw = synthRaw;

      if (!rawPlays.length) {
        // Name the funnel stage that zeroed the plays so the empty state is self-diagnosing in
        // edition meta (no Railway-log dig needed). parsed→stock→within-cap→strike-valid.
        const funnelMsg = funnel
          ? funnel.parsed === 0
            ? `Claude returned no parseable JSON plays (raw ${synthRaw?.length ?? 0} chars).`
            : `All plays filtered out — funnel: ${funnel.parsed} parsed → ${funnel.stock} stock → ${funnel.premium_ok} within-cap → ${funnel.strike_ok} strike-valid.`
          : "Claude returned no parseable plays.";
        const reason = anthropicConfigured()
          ? funnelMsg
          : "Claude not configured and mechanical fallback empty.";
        // Synthesis produced no plays — publish a recap-only edition instead of failing dark, so the
        // UI always shows tonight's market read. Never fabricate plays from nothing.
        console.warn(`[nighthawk/edition] stage_synthesis zeroed — recap-only fallback: ${reason}`);
        await publishRecapOnlyEdition({ editionFor, ctx, reason, candidates: candidates.length, checkpointing, force: Boolean(opts?.force) });
        return {
          ok: true,
          edition_for: editionFor,
          plays_count: 0,
          candidates: candidates.length,
          recap_only: true,
          duration_ms: Date.now() - started,
          job_status: "published",
          current_stage: "published",
        };
      }

      const { plays: vettedPlays, notes: criticNotes } = await critiquePlays({
        plays: rawPlays,
        dossiers,
        ranked,
        ctx,
      });

      finalPlays = vettedPlays;
      finalCriticNotes = criticNotes;
      if (!finalPlays.length) {
        // Critic rejected every play — do NOT publish unvetted fallback content (no fabricated plays).
        // But still write a real published recap-only edition so the UI shows tonight's market read
        // instead of "being built" forever.
        const reason = "Critic rejected all plays — none passed quality review.";
        console.warn(`[nighthawk/edition] stage_critic zeroed — recap-only fallback: ${reason}`);
        await publishRecapOnlyEdition({ editionFor, ctx, reason, candidates: candidates.length, checkpointing, force: Boolean(opts?.force) });
        return {
          ok: true,
          edition_for: editionFor,
          plays_count: 0,
          candidates: candidates.length,
          recap_only: true,
          duration_ms: Date.now() - started,
          job_status: "published",
          current_stage: "published",
        };
      }

      // Checkpoint the vetted Claude output so a resume skips synthesis + critic.
      if (checkpointing) {
        await upsertNighthawkJob(editionFor, {
          synthesis_json: { plays: finalPlays, critic_notes: finalCriticNotes, claude: Boolean(raw) } as unknown as Record<string, unknown>,
          status: "stage_synthesis",
          current_stage: "stage_publish",
        });
        logNighthawkJob(editionFor, "info", "stage_synthesis", `Synthesis + critic done — ${finalPlays.length} vetted plays`);
      }
    }

    // STAGE 6 — Publish
    console.info("[nighthawk/edition] publish edition");
    await upsertNighthawkEdition({
      edition_for: editionFor,
      session_date: ctx.today,
      recap_headline: recap.headline,
      recap_summary: recap.summary,
      market_recap: {
        tide: recap.tide,
        spx_vix: recap.spx_vix,
        sector_strength: recap.sector_strength,
        sector_weakness: recap.sector_weakness,
        catalysts: recap.catalysts,
        hot_chains: ctx.hot_chains.slice(0, 10),
        sector_tides: ctx.sector_tides,
        index_flows: ctx.index_flows,
        top_net_impact: ctx.top_net_impact.slice(0, 10),
        vix_iv_rank: ctx.vix_iv_rank,
        vix_term: ctx.vix_term,
        index_dossiers: indexDossiers,
        spx_desk: spxDesk,
        flow_tape: flowTape,
      },
      plays: finalPlays,
      meta: {
        candidates: candidates.length,
        ranked_tickers: ranked.map((r) => r.ticker),
        claude: Boolean(raw),
        built_at: new Date().toISOString(),
        force: Boolean(opts?.force),
        dossier_context: Object.fromEntries(
          synthesisDossiers
            .filter((d) => d.scored)
            .map((d) => [d.ticker, formatTickerDossierText(d, d.scored!)])
        ),
        play_explanations: {},
        critic_notes: finalCriticNotes,
        critic_applied: Boolean(finalCriticNotes.length),
        platform: {
          spx_price: spxDesk?.price ?? null,
          spx_regime: spxDesk?.gamma_regime ?? null,
          flow_alert_count: flowTape?.count ?? null,
        },
      },
    });

    const sectorByTicker = Object.fromEntries(topDossiers.map((d) => [d.ticker.toUpperCase(), d.sector ?? null]));
    await syncNighthawkPlayOutcomes(editionFor, finalPlays, sectorByTicker);

    if (checkpointing) {
      await upsertNighthawkJob(editionFor, {
        status: "published",
        current_stage: "published",
        published_at: new Date().toISOString(),
        error: null,
      });
      await clearNighthawkStaging(editionFor);
      logNighthawkJob(editionFor, "info", "published", `Edition published with ${finalPlays.length} plays`);
    }

    const finalJob = checkpointing ? await fetchNighthawkJob(editionFor) : null;

    return {
      ok: true,
      edition_for: editionFor,
      plays_count: finalPlays.length,
      candidates: candidates.length,
      duration_ms: Date.now() - started,
      job_status: finalJob?.status ?? "published",
      current_stage: finalJob?.current_stage ?? "published",
      resumed: alreadyDone.length > 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[nighthawk/edition] build failed:", error);
    if (checkpointing) {
      await upsertNighthawkJob(editionFor, { status: "failed", error: message });
      logNighthawkJob(editionFor, "error", null, message);
    }
    const failedJob = checkpointing ? await fetchNighthawkJob(editionFor) : null;
    return {
      ok: false,
      edition_for: editionFor,
      plays_count: 0,
      candidates: 0,
      error: message,
      duration_ms: Date.now() - started,
      job_status: failedJob?.status ?? "failed",
      current_stage: failedJob?.current_stage,
    };
  }
}

export function rowToNightHawkEdition(row: {
  edition_for: string;
  published_at: string;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap: Record<string, unknown>;
  plays: unknown[];
}): NightHawkEdition {
  const plays = (row.plays as PlaybookPlay[]) ?? [];
  return {
    available: plays.length > 0,
    edition_for: row.edition_for,
    published_at: row.published_at,
    recap_headline: row.recap_headline,
    recap_summary: row.recap_summary,
    market_recap: row.market_recap,
    plays: plays.map((p, i) => ({ ...p, rank: p.rank ?? i + 1 })),
  };
}
