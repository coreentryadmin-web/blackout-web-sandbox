// GET /api/admin/bie-report — the live window into what the BLACKOUT Intelligence
// Engine is learning and fixing. Computes all three Layer-5 reports ON DEMAND
// (self-evaluation, gate calibration, platform discovery) plus the interaction
// stats, the knowledge-corpus census, a LIVE embeddings probe (proves the
// provider key actually works, not just that it's set), a retrieval probe, and
// the trail of previously persisted reports — so "what is it improving right
// now?" is one authenticated request, not a wait for the daily cron.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { dbConfigured, fetchBieInteractionStats, fetchBieKnowledge, fetchBieKnowledgeStats } from "@/lib/db";
import { runBieCalibration, formatCalibration } from "@/lib/bie/calibration";
import { runBieDailySelfEval, formatBieReport } from "@/lib/bie/report";
import { runBieDiscovery } from "@/lib/bie/discovery";
import { bieEmbeddingsConfigured, embedTexts } from "@/lib/bie/embeddings";
import { searchKnowledge } from "@/lib/bie/knowledge";

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

  const [selfEval, calibration, discovery, stats, knowledge, probe, trail] = await Promise.all([
    runBieDailySelfEval().catch(() => null),
    runBieCalibration(14).catch(() => null),
    runBieDiscovery().catch(() => null),
    fetchBieInteractionStats(24).catch(() => null),
    fetchBieKnowledgeStats().catch(() => null),
    probeEmbeddings(),
    fetchBieKnowledge({ kind: "self_eval", limit: 30 }).catch(() => []),
  ]);

  // Retrieval probe: only meaningful once the key works — asks the corpus a
  // question the platform docs answer, returns what surfaced and how similar.
  // Floor 0 ON PURPOSE (diagnostic): production retrieval keeps searchKnowledge's
  // default floor; this probe shows the RAW top-3 so the floor can be tuned on
  // evidence — first live run returned empty at 0.55, so we need the distribution.
  const retrieval = probe.ok
    ? await searchKnowledge("How are 0DTE Command plays graded and when do they exit?", 3, 0).catch(() => [])
    : [];

  return NextResponse.json(
    {
      available: true,
      as_of: new Date().toISOString(),
      embeddings: {
        configured: bieEmbeddingsConfigured(),
        probe,
        retrieval_probe: retrieval.map((r) => ({
          source: r.source,
          kind: r.kind,
          similarity: Math.round(r.similarity * 1000) / 1000,
        })),
      },
      knowledge,
      // The three live reports, both structured and human-readable.
      self_eval: selfEval ? { data: selfEval, text: formatBieReport(selfEval) } : null,
      calibration: calibration ? { data: calibration, text: formatCalibration(calibration) } : null,
      discovery: discovery ? { data: { patterns: discovery.patterns }, text: discovery.text } : null,
      interactions_24h: stats,
      // Every previously persisted report — the improvement trail, newest first.
      report_trail: trail.map((r) => ({ source: r.source, at: r.created_at, preview: r.chunk.slice(0, 200) })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
