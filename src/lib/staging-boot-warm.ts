/**
 * One-shot staging cache warm on first nodejs boot — keeps APIs hot across 3 ECS replicas.
 * No-op unless NEXT_PUBLIC_SITE_URL contains "staging.".
 */
let started = false;

export function ensureStagingBootWarm(): void {
  if (started) return;
  if (!(process.env.NEXT_PUBLIC_SITE_URL ?? "").includes("staging.")) return;
  started = true;

  void (async () => {
    try {
      const { fetchGexHeatmap } = await import("@/lib/providers/polygon-options-gex");
      const { prefetchSpxDeskEnrichment } = await import("@/features/spx/lib/spx-desk");
      await Promise.allSettled([
        fetchGexHeatmap("SPX"),
        fetchGexHeatmap("SPY"),
        prefetchSpxDeskEnrichment(),
      ]);
      console.log("[staging-boot-warm] SPX/SPY heatmap + desk enrichment warmed");
    } catch (err) {
      console.warn("[staging-boot-warm] non-fatal:", err);
    }
  })();
}
