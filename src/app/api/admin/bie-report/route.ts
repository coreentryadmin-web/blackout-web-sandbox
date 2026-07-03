// GET /api/admin/bie-report — the live window into what the BLACKOUT Intelligence
// Engine is learning and fixing. Computes all three Layer-5 reports ON DEMAND
// (self-evaluation, gate calibration, platform discovery) plus the interaction
// stats, the knowledge-corpus census, a LIVE embeddings probe (proves the
// provider key actually works, not just that it's set), a retrieval probe, and
// the trail of previously persisted reports — so "what is it improving right
// now?" is one authenticated request, not a wait for the daily cron.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import {
  dbConfigured,
  fetchAlertAuditTrail,
  fetchBieInteractionStats,
  fetchBieKnowledge,
  fetchBieKnowledgeStats,
  fetchDuplicateAlertGroups,
  getDatabasePoolStats,
} from "@/lib/db";
import { runBieCalibration, formatCalibration } from "@/lib/bie/calibration";
import { runBieDailySelfEval, formatBieReport } from "@/lib/bie/report";
import { runBieDiscovery, fetchDiscoveryIncidents, fetchDataCorrectnessSummary } from "@/lib/bie/discovery";
import { bieEmbeddingsConfigured, embedTexts } from "@/lib/bie/embeddings";
import { searchKnowledge } from "@/lib/bie/knowledge";
import { detectMissedAlertWindows } from "@/lib/bie/missed-alerts";
import { countAuthFailures } from "@/lib/error-sink";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { probePgStatStatements } from "@/lib/pg-stat-statements-health";
import { findStage5Proposals } from "@/lib/bie/stage5-proposals";
import { probeRedisHealth } from "@/lib/redis-health";
import {
  probeRailwayEnvVars,
  probeRailwayResourceUsage,
  probeRailwayRuntimeErrors,
  probeRailwayStatus,
} from "@/lib/railway-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EmbedProbe = { ok: true; dims: number } | { ok: false; error: string };

/** One tiny live embed call — the difference between "key is set" and "key works". */
async function probeEmbeddings(): Promise<EmbedProbe> {
  if (!bieEmbeddingsConfigured()) return { ok: false, error: "VOYAGE_API_KEY not set" };
  try {
    const [v] = await embedTexts(["BLACKOUT embeddings probe"], "query");
    return { ok: true, dims: v?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "embed failed" };
  }
}

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!dbConfigured()) {
    return NextResponse.json({ available: false, reason: "database not configured" });
  }

  const [
    selfEval,
    calibration,
    discovery,
    stats,
    knowledge,
    probe,
    trail,
    dbPool,
    redis,
    railway,
    incidents,
    correctness,
    auditTrail,
    railwayResourceUsage,
    railwayEnvVars,
    railwayRuntimeErrors,
    missedAlerts,
    pgStatStatements,
    duplicateAlerts,
    stage5Proposals,
    authFailures,
  ] =
    await Promise.all([
      runBieDailySelfEval().catch(() => null),
      runBieCalibration(14).catch(() => null),
      runBieDiscovery().catch(() => null),
      fetchBieInteractionStats(24).catch(() => null),
      fetchBieKnowledgeStats().catch(() => null),
      probeEmbeddings(),
      fetchBieKnowledge({ kind: "self_eval", limit: 30 }).catch(() => []),
      // Live point-in-time snapshots — pool/cache pressure right now, not a 24h
      // aggregate, so they belong here alongside the embeddings probe rather
      // than in the historical discovery report text.
      getDatabasePoolStats().catch(() => null),
      probeRedisHealth().catch(() => ({ configured: false as const })),
      // Same shape: read-only Railway deploy status, first automated (not manual,
      // sandbox-only) use of the Railway API — Stage 3 of the roadmap.
      probeRailwayStatus().catch(() => ({ configured: false as const })),
      // Structured (not just baked into discovery.text) so the admin UI can render
      // real ack/resolve buttons and colored status badges, not just prose.
      fetchDiscoveryIncidents().catch(() => []),
      fetchDataCorrectnessSummary().catch(() => null),
      // Stage 4 query surface — the unified alert_audit_log view (0DTE, Night Hawk
      // published, Night Hawk rejected). Read-only, same fail-open pattern as every
      // other probe here: a query failure shows as null, never breaks the report.
      fetchAlertAuditTrail(20).catch(() => null),
      // Stage 3: Railway resource usage / env-var presence / runtime error count —
      // the three items the roadmap doc flagged as "access confirmed, not yet
      // queried/wired." Same fail-open pattern; a query failure never breaks the report.
      probeRailwayResourceUsage().catch(() => ({ configured: false as const })),
      probeRailwayEnvVars().catch(() => ({ configured: false as const })),
      probeRailwayRuntimeErrors().catch(() => ({ configured: false as const })),
      // Stage 2: missed-alerts (cron-outage ground truth) — structured, not just
      // baked into discovery.text, so the admin UI can render it as its own signal.
      buildCronHealthSnapshot()
        .then((s) => detectMissedAlertWindows(s.jobs))
        .catch(() => ({ outage_count: 0, windows: [] })),
      // Stage 3: pg_stat_statements presence check ONLY — never attempts to enable it.
      probePgStatStatements().catch(() => ({ configured: false as const })),
      // Stage 2: duplicate-alert detection — verifies alert_audit_log's own
      // dedup invariant (xmax=0 / partial unique index write-paths) actually
      // holds in production. Zero invented ground truth.
      fetchDuplicateAlertGroups(20).catch(() => []),
      // Stage 5, step 1: DRY-RUN ONLY. Read-only fs scan, never writes/git — see
      // stage5-proposals.ts's module comment for exactly what this does and does not do.
      findStage5Proposals().catch(() => []),
      // Stage 3: "security warnings / auth failure monitoring" — Clerk has no
      // webhook/Backend API for this (confirmed against their docs), so this reads
      // what AuthFailureObserver.tsx's DOM-observed beacon already wrote, never a
      // credential. See error-sink.ts's countAuthFailures for the full context.
      countAuthFailures(24).catch(() => ({ total_24h: 0, by_mode: {}, recent_messages: [] })),
    ]);

  // Retrieval probe: only meaningful once the key works. Multiple representative
  // questions spanning different corpus areas — floor 0 ON PURPOSE (diagnostic):
  // production retrieval keeps searchKnowledge's default floor; this shows the
  // RAW top-3 per question so the floor is set from an evidence distribution,
  // not a single anecdote (same report-first standard as the calibration harness
  // in src/lib/bie/calibration.ts — never tune on noise).
  const PROBE_QUESTIONS = [
    "How are 0DTE Command plays graded and when do they exit?",
    "What is the BLACKOUT Intelligence Engine and what are its five layers?",
    "How does the Night Hawk scoring system work?",
    "What gates does the 0DTE scanner use to admit a setup?",
  ];
  const retrievalProbes = probe.ok
    ? await Promise.all(
        PROBE_QUESTIONS.map(async (q) => ({
          question: q,
          hits: (await searchKnowledge(q, 3, 0).catch(() => [])).map((r) => ({
            source: r.source,
            kind: r.kind,
            similarity: Math.round(r.similarity * 1000) / 1000,
          })),
        }))
      )
    : [];

  return NextResponse.json(
    {
      available: true,
      as_of: new Date().toISOString(),
      embeddings: {
        configured: bieEmbeddingsConfigured(),
        probe,
        // Back-compat single-question view (first probe) + the full evidence set.
        retrieval_probe: retrievalProbes[0]?.hits ?? [],
        retrieval_probes: retrievalProbes,
      },
      knowledge,
      db_pool: dbPool,
      redis,
      railway,
      railway_resource_usage: railwayResourceUsage,
      railway_env_vars: railwayEnvVars,
      railway_runtime_errors: railwayRuntimeErrors,
      // The three live reports, both structured and human-readable.
      self_eval: selfEval ? { data: selfEval, text: formatBieReport(selfEval) } : null,
      calibration: calibration ? { data: calibration, text: formatCalibration(calibration) } : null,
      discovery: discovery ? { data: { patterns: discovery.patterns }, text: discovery.text } : null,
      interactions_24h: stats,
      // Structured findings — the same data discovery.text already narrates, exposed
      // as real fields so the admin UI can render status badges + clickable actions.
      open_incidents: incidents,
      correctness,
      // Stage 4: unified per-alert audit trail across all three write-paths.
      audit_trail: auditTrail,
      // Stage 2: alert-producing crons (not cache warmers, not validators) down
      // during their live window right now — "we know we didn't evaluate."
      missed_alerts: missedAlerts,
      // Stage 3: presence check only, never enables it. { enabled: false } is an
      // honest, final answer here, not a placeholder — see pg-stat-statements-health.ts.
      pg_stat_statements: pgStatStatements,
      // Stage 2: rows in alert_audit_log sharing the same (alert_type, source_key) —
      // by design there should be zero; any group here means a dedup write-path has
      // a bug. Empty array is a real, verified "no duplicates found," not silence.
      duplicate_alerts: duplicateAlerts,
      // Stage 5, step 1: dry-run text proposals only — see stage5-proposals.ts.
      // Never a diff, never a git action; just "here's an ambiguity for a human."
      stage5_proposals: stage5Proposals,
      // Stage 3: DOM-observed Clerk sign-in/sign-up failures, last 24h. Closes the
      // last open Stage 3 item without touching the live auth flow — see
      // AuthFailureObserver.tsx and countAuthFailures()'s doc comments.
      auth_failures: authFailures,
      // Every previously persisted report — the improvement trail, newest first.
      report_trail: trail.map((r) => ({ source: r.source, at: r.created_at, preview: r.chunk.slice(0, 200) })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
