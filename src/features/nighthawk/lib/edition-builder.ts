import {
  upsertNighthawkEdition,
  dbConfigured,
  archiveNighthawkStaging,
  clearNighthawkStaging,
  fetchNighthawkEditionByDate,
  fetchNighthawkJob,
  fetchStagedDossierTickers,
  fetchStagedDossiers,
  logNighthawkJob,
  saveDossierStaging,
  upsertNighthawkJob,
  failStaleNighthawkJobs,
} from "@/lib/db";
import { marketPlatform } from "@/lib/platform";
import { uwConfigured } from "@/lib/providers/config";
import { polygonConfigured } from "@/lib/providers/config";
import {
  recordNighthawkRejectedAuditTrail,
  recordNighthawkStageRejectedAuditTrail,
  syncNighthawkPlayOutcomes,
} from "./play-outcomes";
import { extractCandidateTickers } from "./candidates";
import { fetchAllDossiers, resetEditionCongressCache, type TickerDossier } from "./dossier";
import { generateEditionPlays } from "./claude-edition";
import { fetchPlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";
import { buildMarketRecap, formatTickerDossierText } from "./format";
import { fetchIndexDossiers } from "./index-dossier";
import { fetchMarketWideContext, type MarketWideContext } from "./market-wide";
import { critiquePlays } from "./play-critic";
import { rankCandidates, regimeContextFromMarket, type ScoredCandidate } from "./scorer";
import { rescoreDossier } from "./hunt-builder";
import { DOSSIER_BATCH_SIZE, EDITION_SYNTHESIS_POOL, EDITION_TARGET_PLAYS, MAX_CANDIDATES, MAX_DOSSIER_STOCKS } from "./constants";
import { backfillThinEditionPlays } from "./play-backfill";
import { buildNighthawkPublishContexts } from "./publish-context";
import {
  acceptableQuoteSessionsEt,
  applyNighthawkPublishGates,
  publishGateRecapReason,
  type NighthawkPublishGateResult,
} from "./publish-gates";
import { partitionPlaysByGeometry } from "./play-constraints";
import { nextTradingDayEt, todayEt } from "./session";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import type { NightHawkEdition, PlaybookPlay } from "./types";

/**
 * Consolidated funnel counts for ONE edition build (#77 deliverable (a)). Every stage of the
 * candidate→play pipeline writes its count here, and `logFunnel` emits a single line at EVERY exit
 * (success and all five recap-only fallbacks) so the next run pinpoints the exact drop without a
 * Railway-log dig. Stages, left→right, mirror the pipeline order:
 *   candidates  — extractCandidateTickers (flow feed → candidate tickers)
 *   ranked      — rankCandidates output (scored dossiers → ranked pool)
 *   dossiers    — dossiers actually sent to Claude synthesis (synthesisDossiers)
 *   synthesized — RAW plays Claude returned & parsed, BEFORE strike/premium/stock filters (funnel.parsed)
 *   critic_passed — plays surviving critiquePlays
 *   published   — final plays written to the edition row (0 ⇒ recap-only)
 */
type FunnelCounts = {
  candidates: number;
  ranked: number;
  dossiers: number;
  synthesized: number;
  critic_passed: number;
  published: number;
  // NUMERIC-GROUNDING (audit P0): plays that passed deterministic chain/dossier grounding, plays
  // HARD-dropped as ungrounded (off-chain strike / null|way-off premium), and plays kept-but-flagged
  // for a SOFT divergence (flow/level/prose/PT). Emitted on the funnel line so grounding is observable.
  grounded: number;
  dropped_ungrounded: number;
  flagged: number;
};

function formatFunnelLine(editionFor: string, f: Partial<FunnelCounts>): string {
  const c = (n: number | undefined) => (n == null ? "-" : n);
  return (
    `[nighthawk-funnel] ${editionFor}: candidates=${c(f.candidates)} extracted, ` +
    `ranked=${c(f.ranked)}, dossiers=${c(f.dossiers)}, ` +
    `synthesized=${c(f.synthesized)} (claude raw plays), ` +
    `critic_passed=${c(f.critic_passed)}, ` +
    `grounded=${c(f.grounded)}, dropped_ungrounded=${c(f.dropped_ungrounded)}, flagged=${c(f.flagged)}, ` +
    `published=${c(f.published)}`
  );
}

function logFunnel(editionFor: string, f: Partial<FunnelCounts>): string {
  const line = formatFunnelLine(editionFor, f);
  console.info(line);
  return line;
}

/**
 * Recap-only collapses come in two flavors (#77 hardening D, item 9):
 *  - BENIGN: no flow candidates at all (thin tape / UW returned nothing) — `funnel.candidates === 0`.
 *    Expected on a quiet evening, NOT worth paging ops.
 *  - ANOMALOUS: candidates EXISTED but the funnel zeroed downstream (no scored dossiers, Claude
 *    synthesized=0, critic dropped everything, empty finalPlays). This points at a real pipeline
 *    problem (data/scoring/Claude/critic) hiding behind an ok:true recap-only — alert ops (warning).
 * No-op until DISCORD_OPS_WEBHOOK_URL is set; never throws.
 */
async function alertRecapOnlyIfAnomalous(
  editionFor: string,
  funnel: Partial<FunnelCounts>,
  reason: string,
  opts?: { flowFetchFailed?: boolean }
): Promise<void> {
  // Zero candidates is benign ONLY when the flow feed genuinely returned a thin
  // tape. When the fetch itself errored, zero candidates IS the incident — the
  // audit found a UW outage and a quiet evening were indistinguishable here.
  const benign = (funnel.candidates ?? 0) === 0 && !opts?.flowFetchFailed;
  if (benign) return;
  await notifyOpsDiscord({
    severity: "warning",
    title: `Night Hawk recap-only (anomalous collapse) — ${editionFor}`,
    body: `reason: ${reason}\n${formatFunnelLine(editionFor, funnel)}`,
  }).catch(() => undefined);
}

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
export function serializeBuildError(error: unknown): string {
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
 * Durable persistence for Night Hawk's per-candidate scoring dossiers (task #129 — the Night Hawk
 * analogue of task #108's `spx_engine_snapshots` durability fix). `nighthawk_dossiers_staging` is a
 * SCRATCH table: scoreCandidate()'s full flow/tech/pos/news/smart-money/fundamental/short-interest/
 * catalyst breakdown for every ticker the nightly hunt considered lives there only until
 * `clearNighthawkStaging()` deletes it — which happens the moment the edition publishes, OR the run
 * collapses to a recap-only fallback, OR a force-rebuild's clobber guard defers to an existing good
 * edition (every one of this function's 4 call sites below). So "why was ticker X scored/excluded
 * tonight" was only answerable while the run was still in flight; by the next morning, when a member
 * actually asks Largo (`get_nighthawk_dossier`), the staging rows were already gone.
 *
 * Every former direct call to `clearNighthawkStaging()` now goes through this wrapper instead, so the
 * archive write always lands immediately before the delete, at the exact same point in the pipeline
 * `clearNighthawkStaging()` used to run — WHEN staging is cleared relative to publish is unchanged;
 * this only interposes a durable copy first. Archiving is best-effort: a failure is logged and
 * swallowed, never blocks the clear — a stuck staging table would break the NEXT run's
 * checkpoint-resume logic (`fetchStagedDossierTickers` gating `remaining` in stage_dossiers below),
 * which is worse than losing one night's post-hoc queryability.
 */
export async function archiveAndClearNighthawkStaging(editionFor: string): Promise<void> {
  try {
    const archived = await archiveNighthawkStaging(editionFor);
    if (archived > 0) {
      console.info(`[nighthawk/edition] archived ${archived} scoring dossier(s) for ${editionFor} before staging clear`);
    }
  } catch (err) {
    console.warn(`[nighthawk/edition] scoring-history archive failed for ${editionFor} — staging will still clear:`, err);
  }
  await clearNighthawkStaging(editionFor);
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
}) {
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

  const recapEdition = {
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
      after_hours_catalysts: ctx.after_hours_catalysts?.slice(0, 10) ?? [],
    },
    plays: [] as PlaybookPlay[],
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
  };

  // When the DB is not configured (!checkpointing === !dbConfigured()) upsertNighthawkEdition throws
  // 'DATABASE_URL not set' (#77 hardening C). Skip the persist entirely and return the in-memory recap
  // so a non-checkpointing run still yields a usable recap edition instead of throwing. When the DB IS
  // configured, wrap the write so a transient DB error here can't take down the whole rescue path.
  if (checkpointing) {
    // CLOBBER GUARD: never overwrite an already-published edition that HAS plays with a
    // plays:[] recap. The exception rescue runs on ANY post-context throw — including one
    // AFTER the full edition row was already written (e.g. a transient DB error in the
    // post-publish outcome sync) — and a force rebuild that collapses at a later stage
    // (one-off Claude timeout) lands here too. In both cases the members' good playbook
    // must win over the rescue; only a genuinely play-less date gets the recap row.
    const existing = await fetchNighthawkEditionByDate(editionFor).catch(() => null);
    const existingPlays = Array.isArray(existing?.plays) ? existing.plays.length : 0;
    if (existingPlays > 0) {
      console.warn(
        `[nighthawk/edition] recap-only SKIPPED — existing ${editionFor} edition has ${existingPlays} plays; keeping it (${reason})`
      );
      await upsertNighthawkJob(editionFor, {
        status: "published",
        current_stage: "published",
        published_at: new Date().toISOString(),
        error: null,
      });
      await archiveAndClearNighthawkStaging(editionFor);
      logNighthawkJob(
        editionFor,
        "warn",
        "published",
        `Recap-only skipped — kept existing ${existingPlays}-play edition (${reason})`
      );
      return recapEdition;
    }
    await upsertNighthawkEdition(recapEdition);
  } else {
    console.warn(
      `[nighthawk/edition] recap-only: DB not configured — skipping upsert, returning in-memory recap (${reason})`
    );
  }

  if (checkpointing) {
    await upsertNighthawkJob(editionFor, {
      status: "published",
      current_stage: "published",
      published_at: new Date().toISOString(),
      error: null,
    });
    await archiveAndClearNighthawkStaging(editionFor);
    logNighthawkJob(editionFor, "info", "published", `Recap-only edition published (no plays) — ${reason}`);
  }

  return recapEdition;
}

export async function buildEveningEdition(opts?: {
  force?: boolean;
}): Promise<EditionBuildResult> {
  const started = Date.now();
  const editionFor = nextTradingDayEt(todayEt());
  const checkpointing = dbConfigured();

  if (checkpointing) {
    await failStaleNighthawkJobs().catch((err) =>
      console.warn("[nighthawk/edition] stale-job cleanup failed:", err)
    );
  }

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
    // Staging for THIS editionFor should already be empty here (the prior successful publish
    // already archived+cleared it below) — this is a defensive reset in case that didn't happen
    // cleanly (e.g. a process crash between archive and clear on the prior run). Routed through
    // the same archive-then-clear wrapper rather than a bare clear so that edge case can never
    // silently drop a scoring dossier either.
    await archiveAndClearNighthawkStaging(editionFor);
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

  // Running funnel accumulator (#77 deliverable (a)) — each stage fills in its count and every
  // terminal exit below calls logFunnel(editionFor, funnel) so the drop point is always visible.
  const funnel: Partial<FunnelCounts> = {};

  // Hoisted to function scope so the outer catch can route to a recap-only edition once context
  // exists (#77 hardening C): if a LATER stage throws but ctx was already built, we still publish a
  // real recap row instead of falling straight through to failed/no-row.
  let ctx: MarketWideContext | null = null;

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
    ctx = (job?.context_json as MarketWideContext | null) ?? null;
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
      candidates = await extractCandidateTickers(ctx.stock_flows, ctx.hot_chains, MAX_CANDIDATES, {
        topNetImpact: ctx.top_net_impact,
      });
      if (!candidates.length) {
        // Funnel collapsed at stage_candidates — the flow feed was genuinely empty (thin tape, or UW
        // returned nothing). Do NOT leave the UI "being built": publish a recap-only edition.
        const reason = `No flow candidates (stock_flows ${ctx.stock_flows.length}, hot_chains ${ctx.hot_chains.length}).`;
        console.warn(`[nighthawk/edition] stage_candidates zeroed — recap-only fallback: ${reason}`);
        funnel.candidates = 0;
        funnel.published = 0;
        logFunnel(editionFor, funnel);
        await alertRecapOnlyIfAnomalous(editionFor, funnel, reason, {
          flowFetchFailed: ctx.flow_fetch_failed,
        });
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
    funnel.candidates = candidates.length;

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

    // Session-aware re-score (audit fix): buildTickerDossier scores WITHOUT the session
    // context, so the earnings-proximity −6 penalty ("expiry into earnings") and the
    // analyst-PT nudge were dead code on the edition path — only the hunt path passed
    // earnings_date/today/tomorrow. Re-score every dossier with the same helper the
    // hunt uses (deterministic + idempotent, safe on checkpoint-resumed dossiers too).
    for (const d of Object.values(dossiers)) {
      try {
        rescoreDossier(d, regime, 1, {
          today: ctx.today,
          tomorrow: ctx.tomorrow,
          tomorrow_earnings: ctx.tomorrow_earnings ?? [],
        });
      } catch (err) {
        console.warn(`[nighthawk/edition] session rescore failed for ${d.ticker} — keeping base score:`, err);
      }
    }

    const scoredList = Object.values(dossiers)
      .filter((d) => d.scored != null)
      .map((d) => d.scored!);

    if (!scoredList.length) {
      // Funnel collapsed at stage_dossiers — candidates existed but none produced a scored dossier
      // (dossier fetch/scoring failures). Publish a recap-only edition rather than failing dark.
      const reason = `No scored dossiers after staging (${candidates.length} candidate(s)).`;
      console.warn(`[nighthawk/edition] stage_dossiers zeroed — recap-only fallback: ${reason}`);
      funnel.ranked = 0;
      funnel.dossiers = 0;
      funnel.published = 0;
      logFunnel(editionFor, funnel);
      await alertRecapOnlyIfAnomalous(editionFor, funnel, reason);
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
      // Defense-in-depth backstop. rankCandidates now soft-demotes (never hard-cuts) fundamental_block
      // names, so it only returns empty when EVERY candidate is halted — in which case this rescue
      // can't help either. Kept as a belt-and-suspenders guard against a future regression in the
      // ranker: if ranking is somehow empty while non-halted candidates exist, rank those by score.
      // (Halts stay excluded — you cannot trade a halted name. Claude + critic still vet downstream.)
      if (!ranked.length) {
        const tradable = scoredList.filter((c) => !c.trading_halt);
        if (tradable.length) {
          ranked = [...tradable].sort((a, b) => b.score - a.score).slice(0, MAX_DOSSIER_STOCKS);
          console.warn(
            `[nighthawk/edition] stage_scoring rescue — ranking zeroed; ranking ${ranked.length} non-halted candidate(s) instead.${rankExclusionReason ? ` (${rankExclusionReason})` : ""}`
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

    funnel.ranked = ranked.length;

    const topDossiers = ranked.map((s) => dossiers[s.ticker]).filter(Boolean);
    const synthesisRanked = ranked.slice(0, EDITION_SYNTHESIS_POOL);
    const synthesisDossiers = synthesisRanked.map((s) => dossiers[s.ticker]).filter(Boolean);
    funnel.dossiers = synthesisDossiers.length;

    if (!synthesisDossiers.length) {
      // Nothing survived to synthesis (e.g. every candidate halted, or ranking empty after rescue).
      // A Claude call with no dossiers can only return nothing — short-circuit to recap-only so a
      // real published row is written instead of failing through the synthesis path.
      const reason = `No dossiers to synthesize (${candidates.length} candidate(s), 0 ranked).`;
      console.warn(`[nighthawk/edition] stage_synthesis pre-empty — recap-only fallback: ${reason}`);
      funnel.synthesized = 0;
      funnel.published = 0;
      logFunnel(editionFor, funnel);
      await alertRecapOnlyIfAnomalous(editionFor, funnel, reason);
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
    // Numeric-grounding summary captured from synthesis so it can be stamped into edition meta and
    // re-stamped onto the funnel counts. Null on a resumed run (synthesis ran on a prior invocation).
    let groundingSummary: { grounded: number; dropped_ungrounded: number; flagged: number; notes: string[] } | null = null;

    if (checkpointedSynthesis && Array.isArray(checkpointedSynthesis.plays) && checkpointedSynthesis.plays.length) {
      finalPlays = checkpointedSynthesis.plays.slice(0, EDITION_TARGET_PLAYS).map((p, i) => ({
        ...p,
        rank: i + 1,
      }));
      finalCriticNotes = Array.isArray(checkpointedSynthesis.critic_notes) ? checkpointedSynthesis.critic_notes : [];
      raw = checkpointedSynthesis.claude ? "checkpointed" : null;
      console.info(`[nighthawk/edition] stage_synthesis: loaded ${finalPlays.length} vetted plays from checkpoint`);
      // Counts unknown on resume (synthesis/critic ran on a prior invocation) — record what we can.
      funnel.synthesized = finalPlays.length;
      funnel.critic_passed = finalPlays.length;
    } else {
      const {
        plays: rawPlays,
        raw: synthRaw,
        funnel: synthFunnel,
        grounding: synthGrounding,
        geometryRejected,
        stageRejected,
      } = await generateEditionPlays({
        ctx,
        dossiers: synthesisDossiers,
        ranked: synthesisRanked,
        engineState,
        spxDesk,
        flowTape,
        playOutcomes,
      });
      raw = synthRaw;
      // BIE Stage 4 audit trail (step 4b): one row per geometry-rejected play, regardless of
      // whether the run ultimately publishes anything — this is the ONLY record of a
      // rejection, so it must not depend on the downstream funnel outcome. Fire-and-forget,
      // dedup'd at the DB layer (see insertNighthawkRejectedAuditLog) so a force-rebuild that
      // re-derives the same rejection never writes a duplicate row. Called unconditionally,
      // same as syncNighthawkPlayOutcomes below — a DB-not-configured environment fails the
      // write silently via the caught rejection, never propagating.
      if (geometryRejected?.length) {
        recordNighthawkRejectedAuditTrail(geometryRejected, editionFor);
      }
      // task #141: same treatment for the 3 LATER funnel rejection stages (premium-cap,
      // illiquid-strike, ungrounded) plus sector-concentration — previously console.warn-only,
      // so "why was ticker X rejected tonight" had no durable answer for any of these. Same
      // fire-and-forget / dedup / unconditional-call semantics as geometryRejected above.
      if (stageRejected?.length) {
        recordNighthawkStageRejectedAuditTrail(stageRejected, editionFor);
      }
      // Stamp grounding counts onto the funnel so EVERY exit (incl. recap-only fallbacks below)
      // reports them. The checks already ran inside generateEditionPlays before any drop took effect.
      groundingSummary = synthGrounding ?? null;
      funnel.grounded = synthFunnel?.grounded ?? 0;
      funnel.dropped_ungrounded = synthFunnel?.dropped_ungrounded ?? 0;
      funnel.flagged = synthFunnel?.flagged ?? 0;
      // Synthesized = RAW Claude plays parsed BEFORE the strike/premium/stock filters (funnel.parsed).
      // This is the single most important number for #77: parsed=0 means Claude returned nothing
      // parseable (the timeout bug fixed in claude-edition.ts), whereas parsed>0 but published=0 means
      // a downstream filter zeroed it.
      funnel.synthesized = synthFunnel?.parsed ?? rawPlays.length;

      if (!rawPlays.length) {
        // Name the funnel stage that zeroed the plays so the empty state is self-diagnosing in
        // edition meta (no Railway-log dig needed). parsed→stock→within-cap→strike-valid.
        const reason = synthFunnel
          ? `All plays filtered out — funnel: ${synthFunnel.parsed} candidates → ${synthFunnel.stock} contract-ok → ${synthFunnel.premium_ok} within-cap → ${synthFunnel.strike_ok} strike-valid → 0 grounded (${synthFunnel.dropped_ungrounded} dropped ungrounded, ${synthFunnel.flagged} flagged).`
          : "Deterministic synthesis produced no plays.";
        // Synthesis produced no plays — publish a recap-only edition instead of failing dark, so the
        // UI always shows tonight's market read. Never fabricate plays from nothing.
        console.warn(`[nighthawk/edition] stage_synthesis zeroed — recap-only fallback: ${reason}`);
        funnel.critic_passed = 0;
        funnel.published = 0;
        logFunnel(editionFor, funnel);
        await alertRecapOnlyIfAnomalous(editionFor, funnel, reason);
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

      finalPlays = vettedPlays.slice(0, EDITION_TARGET_PLAYS).map((p, i) => ({ ...p, rank: i + 1 }));
      finalCriticNotes = criticNotes;
      funnel.critic_passed = finalPlays.length;
      if (!finalPlays.length) {
        // Critic rejected every play — do NOT publish unvetted fallback content (no fabricated plays).
        // But still write a real published recap-only edition so the UI shows tonight's market read
        // instead of "being built" forever.
        const reason = "Critic rejected all plays — none passed quality review.";
        console.warn(`[nighthawk/edition] stage_critic zeroed — recap-only fallback: ${reason}`);
        funnel.published = 0;
        logFunnel(editionFor, funnel);
        await alertRecapOnlyIfAnomalous(editionFor, funnel, reason);
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

    // STAGE 5b — Thin-edition backfill. When grounding/critic over-prune below the ops floor,
    // top up from the ranked pool with chain-grounded affordable contracts (never fabricated quotes).
    {
      const { plays: toppedUp, notes: backfillNotes } = await backfillThinEditionPlays({
        finalPlays,
        ranked: synthesisRanked,
        dossiers,
      });
      if (backfillNotes.length) {
        finalPlays = toppedUp.slice(0, EDITION_TARGET_PLAYS).map((p, i) => ({ ...p, rank: i + 1 }));
        finalCriticNotes = [...finalCriticNotes, ...backfillNotes];
        funnel.critic_passed = finalPlays.length;
        console.info(
          `[nighthawk/edition] thin-edition backfill — ${finalPlays.length} play(s) after ranked-pool top-up`
        );
      }
    }

    // STAGE 6 — Publish
    // FINAL GEOMETRY GATE: thin-edition backfill and checkpoint-resume can introduce plays that
    // never ran through generateEditionPlays' geometry filter — reject them here rather than
    // persisting untradeable risk plans (audit task #146 / ops #519).
    {
      const { passing, failing } = partitionPlaysByGeometry(finalPlays);
      if (failing.length) {
        console.warn(
          "[nighthawk/edition] final geometry gate rejected:",
          failing.map((f) => `${f.play.ticker}: ${f.drops.join("; ")}`)
        );
        finalPlays = passing.map((p, i) => ({ ...p, rank: i + 1 }));
        funnel.published = finalPlays.length;
        funnel.critic_passed = finalPlays.length;
      }
    }

    // PR-N3 PUBLISH GATES (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §N-3): band-vs-spot,
    // achievable target, stale-quote basis, fail-closed on unknown geometry — evaluated on
    // the SAME in-memory dossiers the publish-context pin reads, strictly AFTER backfill so
    // the backfill class that shipped the six 6.4%–45.5% detached plays cannot slip past.
    // BLOCKED plays never publish: they persist as nighthawk_rejected audit rows (their ONLY
    // record — counterfactual-gradeable later, same skip-grading philosophy as 0DTE), and
    // every play's gate result (PASSES with margins included) is pinned into
    // publish_context.gates below as the threshold-calibration substrate.
    let gateResults: Record<string, NighthawkPublishGateResult> = {};
    {
      const { passing, blocked, results } = applyNighthawkPublishGates({
        plays: finalPlays,
        dossiers,
        quoteSessions: acceptableQuoteSessionsEt(),
      });
      gateResults = results;
      if (blocked.length) {
        console.warn(
          "[nighthawk/edition] publish gates BLOCKED:",
          blocked.map((b) => `${b.ticker}: ${b.result.blocks.map((x) => x.code).join(",")}`)
        );
        // Durable rejection rows FIRST — recorded regardless of whether anything publishes
        // below (same unconditional/fire-and-forget semantics as the synthesis-stage rows).
        recordNighthawkStageRejectedAuditTrail(
          blocked.map((b) => ({
            ticker: b.ticker,
            play: b.play,
            detail: { stage: "publish_gate" as const, blocks: b.result.blocks },
            scored: b.scored,
          })),
          editionFor
        );
        finalPlays = passing;
        funnel.critic_passed = finalPlays.length;
      }
      if (!finalPlays.length) {
        // The gates zeroed the edition — publish an HONEST recap-only edition (the doc's
        // rule: zero honest plays beats one unfillable play; tonight's real 7/14 edition
        // was already honestly zero-play). Mirrors the synthesis/critic-zeroed exits.
        const reason = publishGateRecapReason(blocked);
        console.warn(`[nighthawk/edition] publish gates zeroed — recap-only fallback: ${reason}`);
        funnel.published = 0;
        logFunnel(editionFor, funnel);
        await alertRecapOnlyIfAnomalous(editionFor, funnel, reason);
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
    }

    // WRITE-SIDE INVARIANT (#77): never persist a "normal" edition with zero plays. The five funnel
    // exits above already route an empty funnel to publishRecapOnlyEdition (recap_only:true in meta).
    // This last-resort guard catches any way finalPlays could arrive empty here — a stale/old
    // checkpoint, a future regression — and routes it to the SAME recap-only publish so the row is
    // never written with plays=0 + recap_only:false. Guarantees: published && plays==0 ⟹ recap_only.
    if (!finalPlays.length) {
      const reason = "Synthesis reached publish with zero plays (checkpoint/guard slip) — recap-only.";
      console.warn(`[nighthawk/edition] publish guard — empty finalPlays, recap-only fallback: ${reason}`);
      funnel.published = 0;
      logFunnel(editionFor, funnel);
      await alertRecapOnlyIfAnomalous(editionFor, funnel, reason);
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

    funnel.published = finalPlays.length;
    logFunnel(editionFor, funnel);
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
        after_hours_catalysts: ctx.after_hours_catalysts?.slice(0, 10) ?? [],
      },
      plays: finalPlays,
      meta: {
        candidates: candidates.length,
        ranked_tickers: ranked.map((r) => r.ticker),
        claude: Boolean(raw),
        // Write-site invariant (#77): a normal publish always has plays (the guard above returns
        // early on empty), so this is always false here — but stamp it explicitly so meta.recap_only
        // is authoritative and never absent on a published row. The empty-funnel path stamps `true`.
        recap_only: finalPlays.length === 0,
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
        funnel: {
          candidates: funnel.candidates ?? candidates.length,
          ranked: funnel.ranked ?? ranked.length,
          dossiers: funnel.dossiers ?? synthesisDossiers.length,
          synthesized: funnel.synthesized ?? 0,
          critic_passed: funnel.critic_passed ?? finalPlays.length,
          published: finalPlays.length,
          grounded: funnel.grounded ?? 0,
          dropped_ungrounded: funnel.dropped_ungrounded ?? 0,
          flagged: funnel.flagged ?? 0,
        },
        platform: {
          spx_price: spxDesk?.price ?? null,
          spx_regime: spxDesk?.gamma_regime ?? null,
          flow_alert_count: flowTape?.count ?? null,
          composite_regime: ctx.platform_intel?.composite_regime ?? null,
          critical_anomalies: ctx.platform_intel?.critical_anomaly_count ?? 0,
        },
      },
    });

    // POST-PUBLISH steps are isolated from the outer catch: the edition row is already
    // written (members are served), so a transient DB error here must NOT propagate —
    // the exception rescue would then "rescue" a successful publish by overwriting it
    // with a plays:[] recap (belt to the clobber guard's suspenders). On job-flip
    // failure the job stays non-published and the next cron fire resumes from the
    // synthesis checkpoint and re-publishes idempotently — strictly better than the
    // rescue. Outcome-sync failure self-heals the same way (sync is idempotent).
    try {
      const sectorByTicker = Object.fromEntries(topDossiers.map((d) => [d.ticker.toUpperCase(), d.sector ?? null]));
      // PR-N4 evidence pin: what the builder saw for each play, captured from the SAME
      // in-memory context/dossiers this build published from — never re-fetched. The
      // builder is fail-soft by contract (per-play failures pin null + warn), so the
      // worst case is an un-pinned row, never a blocked outcome sync or publish.
      const publishContexts = buildNighthawkPublishContexts({
        plays: finalPlays,
        dossiers,
        market: {
          regime: regimeContextFromMarket(ctx),
          market_breadth: ctx.market_breadth,
          tomorrow_earnings: ctx.tomorrow_earnings,
          tomorrow: ctx.tomorrow,
          vix_close: ctx.vix_bars.at(-1)?.c ?? null,
          spx_close: ctx.spx_bars.at(-1)?.c ?? null,
        },
        builtAt: new Date().toISOString(),
        // PR-N3: pin each published play's gate verdict + PASS margins — the exact
        // objects that gated this publish, never re-evaluated.
        gateResults,
      });
      await syncNighthawkPlayOutcomes(editionFor, finalPlays, sectorByTicker, publishContexts);

      if (checkpointing) {
        await upsertNighthawkJob(editionFor, {
          status: "published",
          current_stage: "published",
          published_at: new Date().toISOString(),
          error: null,
        });
        await archiveAndClearNighthawkStaging(editionFor);
        logNighthawkJob(editionFor, "info", "published", `Edition published with ${finalPlays.length} plays`);
      }
    } catch (postPublishError) {
      const msg = serializeBuildError(postPublishError);
      console.error(`[nighthawk/edition] post-publish step failed (edition IS live): ${msg}`);
      await notifyOpsDiscord({
        severity: "warning",
        title: `Night Hawk post-publish step failed — ${editionFor}`,
        body: `Edition with ${finalPlays.length} plays IS published; outcome-sync/job-flip failed and will retry on the next cron fire.\nerror: ${msg}`,
      }).catch(() => undefined);
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
    const message = serializeBuildError(error);
    console.error("[nighthawk/edition] build failed:", error);
    // Emit whatever funnel counts we accumulated before the throw, so an exception path is also
    // self-diagnosing (which stage we got to before failing). published is left undefined ("-").
    const funnelLine = logFunnel(editionFor, funnel);

    // RECAP-ONLY RESCUE (#77 hardening C): if context was already built before a LATER stage threw,
    // we can STILL publish a real recap-only edition instead of going dark (failed/no-row). This
    // catches the #77 dark-fail relocated to any post-context stage. Best-effort — if the recap
    // publish itself throws, fall through to the failed path below.
    if (ctx != null) {
      try {
        const reason = `Build threw after context (recap-only rescue): ${message}`;
        console.warn(`[nighthawk/edition] recap-only rescue after exception — ${reason}`);
        await publishRecapOnlyEdition({
          editionFor,
          ctx,
          reason,
          candidates: funnel.candidates ?? 0,
          checkpointing,
          force: Boolean(opts?.force),
        });
        // This is NOT a benign collapse — a mid-build exception forced a recap-only. Alert ops.
        await notifyOpsDiscord({
          severity: "warning",
          title: `Night Hawk recap-only RESCUE (build threw) — ${editionFor}`,
          body: `error: ${message}\n${funnelLine}`,
        }).catch(() => undefined);
        return {
          ok: true,
          edition_for: editionFor,
          plays_count: 0,
          candidates: funnel.candidates ?? 0,
          recap_only: true,
          duration_ms: Date.now() - started,
          job_status: "published",
          current_stage: "published",
        };
      } catch (rescueError) {
        // Recap publish itself failed (e.g. DATABASE_URL not set on a non-checkpointing run, or a
        // transient DB error). Log and fall through to the hard-failed path so the failure is still
        // recorded + alerted.
        console.error("[nighthawk/edition] recap-only rescue failed:", rescueError);
      }
    }

    if (checkpointing) {
      await upsertNighthawkJob(editionFor, { status: "failed", error: message });
      logNighthawkJob(editionFor, "error", null, message);
    }
    const failedJob = checkpointing ? await fetchNighthawkJob(editionFor) : null;
    // Ops alert on a hard edition-build failure (#77 was invisible to ops). No-op until
    // DISCORD_OPS_WEBHOOK_URL is set; never throws (notifyOpsDiscord swallows its own errors).
    await notifyOpsDiscord({
      severity: "critical",
      title: `Night Hawk edition build FAILED — ${editionFor}`,
      body:
        `stage=${failedJob?.current_stage ?? "unknown"}\n` +
        `error: ${message}\n` +
        funnelLine,
    }).catch(() => undefined);
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

/** A published edition has SOMETHING to show when it carries a recap headline, a recap summary, or a
 *  market_recap payload — even with zero plays. buildMarketRecap always emits a non-empty headline +
 *  summary, so any recap-only row written by publishRecapOnlyEdition satisfies this. */
function hasRecapContent(row: {
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap: Record<string, unknown> | null | undefined;
}): boolean {
  if (row.recap_headline && row.recap_headline.trim()) return true;
  if (row.recap_summary && row.recap_summary.trim()) return true;
  if (row.market_recap && Object.keys(row.market_recap).length > 0) return true;
  return false;
}

/**
 * AIRTIGHT `available` GATE (#77). This is the single chokepoint both the edition GET route and the
 * platform service read through, so the invariant lives here once:
 *
 *   published row with plays.length > 0      → available (full playbook)
 *   published row with plays.length === 0    → available IFF it carries recap content (recap-only)
 *
 * The old gate was `available: plays.length > 0`, which wrongly marked EVERY recap-only edition
 * (all five funnel-collapse fallbacks) unavailable — the UI then showed "awaiting close" forever even
 * though a real recap was published. By gating on recap content instead, a zero-play row that was
 * published with a recap (the guaranteed `publishRecapOnlyEdition` output) now computes available=true,
 * and the UI renders the recap. It also self-heals the one rogue row that published plays=0 with
 * recap_only unset in meta: as long as it has a recap (it does — recap fields are always written on
 * publish), it is now available. A truly empty row (no plays AND no recap) stays unavailable.
 */
export function rowToNightHawkEdition(row: {
  edition_for: string;
  published_at: string;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap: Record<string, unknown>;
  plays: unknown[];
  meta?: Record<string, unknown> | null;
}): NightHawkEdition {
  const plays = (row.plays as PlaybookPlay[]) ?? [];
  const recapPresent = hasRecapContent(row);
  const recapOnly = plays.length === 0 && recapPresent;
  return {
    // available when there are plays, OR when a recap was published (recap-only edition).
    available: plays.length > 0 || recapPresent,
    edition_for: row.edition_for,
    published_at: row.published_at,
    recap_headline: row.recap_headline,
    recap_summary: row.recap_summary,
    market_recap: row.market_recap,
    plays: plays.map((p, i) => ({ ...p, rank: p.rank ?? i + 1 })),
    recap_only: recapOnly,
  };
}
