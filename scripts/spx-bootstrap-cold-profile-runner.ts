/**
 * Cold-path timing for SPX bootstrap lanes — run via:
 *   npx tsx scripts/spx-bootstrap-cold-profile-runner.ts
 */
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  const p = require.resolve("server-only");
  require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as NodeModule;
} catch {
  /* optional */
}

type Step = { name: string; ms: number };

function msSince(t0: number): number {
  return Math.round(performance.now() - t0);
}

async function time(name: string, fn: () => Promise<unknown>): Promise<Step> {
  const t0 = performance.now();
  await fn();
  return { name, ms: msSince(t0) };
}

const SPX = "I:SPX";
const VIX = "I:VIX";
const VIX9D = "I:VIX9D";
const VIX3M = "I:VIX3M";
const TICK = "I:TICK";
const TRIN = "I:TRIN";
const ADD = "I:ADD";

async function profileDeskPhases(): Promise<Step[]> {
  const { todayEtYmd, priorEtYmd } = await import("@/lib/providers/spx-session");
  const {
    fetchIndexSnapshots,
    fetchIndexMinuteBars,
    fetchIndexDailyBars,
    fetchIndexEma,
    fetchIndexSma,
    fetchBreadthUniverseSnapshots,
    fetchBenzingaNews,
    fetchVixIvRankPercentile,
    fetchDailyMarketSummary,
    fetchPriorDayCloses,
  } = await import("@/lib/providers/polygon");
  const { fetchGexHeatmap } = await import("@/lib/providers/polygon-options-gex");
  const { runUwPooled } = await import("@/lib/providers/uw-rate-limiter");
  const {
    fetchUwMarketTide,
    fetchUwNope,
    fetchUwFlowPerExpiry,
    fetchUwNetFlowExpiry,
    fetchUwGroupGreekFlow,
    fetchUwMacroIndicators,
    fetchUwNetPremTicks,
    fetchUwGreekExposureExpiry,
    fetchUwMaxPain,
    fetchUwIvRank,
    fetchUwFlow0dte,
    fetchUwDarkPool,
    fetchMarketFlowAlerts,
  } = await import("@/lib/providers/unusual-whales");
  const { serverCache } = await import("@/lib/server-cache");
  const { mergeMacroEventsToday } = await import("@/lib/providers/macro-events");
  const { resolveDeskGap } = await import("@/lib/providers/gap-proxy");
  const { ensureDataSockets } = await import("@/lib/ws/init-data-sockets");

  const steps: Step[] = [];
  const today = todayEtYmd();
  const fromWeek = priorEtYmd(10);

  steps.push(await time("0_ensureDataSockets", async () => ensureDataSockets()));

  const batch1 = await time("1_polygon_batch (snaps+bars+ema+breadth+news)", async () => {
    await Promise.all([
      fetchIndexSnapshots([SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]),
      fetchIndexMinuteBars(SPX, today, today).catch(() => []),
      fetchIndexDailyBars(SPX, fromWeek, today),
      fetchIndexEma(SPX, 20, "day"),
      fetchIndexEma(SPX, 50, "day"),
      fetchIndexEma(SPX, 200, "day"),
      fetchIndexSma(SPX, 50, "day"),
      fetchIndexSma(SPX, 200, "day"),
      serverCache("breadth-profile", 60_000, () => fetchBreadthUniverseSnapshots()).catch(() => []),
      serverCache("news-profile", 120_000, () => fetchBenzingaNews(15)).catch(() => []),
    ]);
  });
  steps.push(batch1);

  const batch2 = await time("2_gex+iv (fetchGexHeatmap SPX force + VIX IV rank)", async () => {
    await Promise.all([
      fetchGexHeatmap("SPX", { forceRefresh: true }),
      fetchVixIvRankPercentile(),
    ]);
  });
  steps.push(batch2);

  const batch3 = await time("3_uw_pooled_6 (tide,nope,flow0dte,darkpool,maxpain,iv)", async () => {
    await runUwPooled([
      () => fetchUwMarketTide().catch(() => null),
      () => fetchUwNope("SPX").catch(() => null).then((r) => r ?? fetchUwNope("SPY").catch(() => null)),
      () => fetchUwFlow0dte("SPX").catch(() => null),
      () => fetchUwDarkPool("SPX", { limit: 20, min_premium: 500_000 }).catch(() => null),
      () => fetchUwMaxPain("SPX").catch(() => null),
      () => fetchUwIvRank("SPX").catch(() => null),
    ]);
  });
  steps.push(batch3);

  const batch4 = await time("4_flow_alerts (UW market flow, 6s race cap)", async () => {
    await Promise.race([
      fetchMarketFlowAlerts({ ticker: "SPX", limit: 32 }).catch(() => []),
      new Promise<unknown[]>((resolve) => setTimeout(() => resolve([]), 6000)),
    ]);
  });
  steps.push(batch4);

  const batch5 = await time("5_macro+gap+daily (parallel)", async () => {
    await Promise.all([
      mergeMacroEventsToday({ headlines: [] }),
      resolveDeskGap({ spx_price: 6200, prior_close: 6180, premarket: false }),
      fetchDailyMarketSummary(today).catch(() => null),
      fetchPriorDayCloses(today).catch(() => ({})),
    ]);
  });
  steps.push(batch5);

  const batch6 = await time("6_uw_pooled_6 (greek,flowExpiry,netFlow,netPrem,mag7,macro)", async () => {
    await runUwPooled([
      () => fetchUwGreekExposureExpiry("SPX").catch(() => []),
      () => fetchUwFlowPerExpiry("SPX", 12).catch(() => []),
      () => fetchUwNetFlowExpiry(20).catch(() => []),
      () => fetchUwNetPremTicks("SPY").catch(() => []),
      () => fetchUwGroupGreekFlow("mag7").catch(() => []),
      () => fetchUwMacroIndicators().catch(() => []),
    ]);
  });
  steps.push(batch6);

  return steps;
}

async function main() {
  const { todayEtYmd } = await import("@/lib/providers/spx-session");
  const { buildSpxDesk, buildSpxDeskFlow, buildSpxDeskPulse } = await import(
    "@/features/spx/lib/spx-desk"
  );

  console.log("SPX bootstrap cold profile");
  console.log(`ET session: ${todayEtYmd()}`);
  console.log(`Polygon: ${process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY ? "yes" : "no"}`);
  console.log(`UW: ${process.env.UW_API_KEY ? "yes" : "no"}`);
  console.log("");

  console.log("--- buildSpxDesk phase breakdown (sequential batches, mirrors code structure) ---");
  const phases = await profileDeskPhases();
  for (const s of phases) console.log(`  ${String(s.ms).padStart(6)}ms  ${s.name}`);
  const phaseSum = phases.reduce((a, s) => a + s.ms, 0);
  console.log(`  ${String(phaseSum).padStart(6)}ms  (sum — actual desk overlaps batches 1-2, 5-6)\n`);

  console.log("--- full builder timings ---");
  const desk = await time("buildSpxDesk", () => buildSpxDesk());
  const flow = await time("buildSpxDeskFlow", () => buildSpxDeskFlow());
  const pulse = await time("buildSpxDeskPulse", () => buildSpxDeskPulse());

  for (const s of [desk, flow, pulse]) console.log(`  ${String(s.ms).padStart(6)}ms  ${s.name}`);

  const report = {
    ts: new Date().toISOString(),
    session: todayEtYmd(),
    phases,
    phaseSumMs: phaseSum,
    builders: [desk, flow, pulse],
    bootstrapColdEstimateMs: Math.max(desk.ms, flow.ms, pulse.ms),
    prodObservedColdMs: 11355,
    dominantLane: "desk",
    topPhases: [...phases].sort((a, b) => b.ms - a.ms).slice(0, 3).map((p) => p.name),
  };

  console.log("\n--- JSON ---");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
