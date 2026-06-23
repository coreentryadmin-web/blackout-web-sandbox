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
        const err = "No flow candidates found for today's session.";
        if (checkpointing) await upsertNighthawkJob(editionFor, { status: "failed", error: err });
        return {
          ok: false,
          edition_for: editionFor,
          plays_count: 0,
          candidates: 0,
          error: err,
          duration_ms: Date.now() - started,
          job_status: "failed",
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
      const err = "No scored dossiers available after staging.";
      if (checkpointing) await upsertNighthawkJob(editionFor, { status: "failed", error: err });
      return {
        ok: false,
        edition_for: editionFor,
        plays_count: 0,
        candidates: candidates.length,
        error: err,
        duration_ms: Date.now() - started,
        job_status: "failed",
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
      const { plays: rawPlays, raw: synthRaw } = await generateEditionPlays({
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
        const err = anthropicConfigured()
          ? "Claude returned no parseable plays."
          : "Claude not configured and mechanical fallback empty.";
        if (checkpointing) await upsertNighthawkJob(editionFor, { status: "failed", error: err });
        return {
          ok: false,
          edition_for: editionFor,
          plays_count: 0,
          candidates: candidates.length,
          error: err,
          duration_ms: Date.now() - started,
          job_status: "failed",
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
        // Critic rejected every play — do NOT publish unvetted fallback content.
        // Return an explicit error so the caller can send a "no plays tonight" notice.
        const err = "Critic rejected all plays — no plays passed quality review.";
        if (checkpointing) await upsertNighthawkJob(editionFor, { status: "failed", error: err });
        return {
          ok: false,
          edition_for: editionFor,
          plays_count: 0,
          candidates: candidates.length,
          error: err,
          duration_ms: Date.now() - started,
          job_status: "failed",
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
