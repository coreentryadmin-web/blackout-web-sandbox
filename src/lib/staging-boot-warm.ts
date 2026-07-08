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
      const { loadMergedSpxDesk, loadBootstrapBundle } = await import(
        "@/features/spx/lib/spx-desk-loader"
      );
      const { getUwCacheRedis } = await import("@/lib/providers/uw-shared-cache");
      const { seedUwCacheFromWsStores } = await import("@/lib/uw-ws-cache-bridge");

      await Promise.allSettled([
        fetchGexHeatmap("SPX"),
        fetchGexHeatmap("SPY"),
        prefetchSpxDeskEnrichment(),
        loadMergedSpxDesk(),
        loadBootstrapBundle(),
      ]);

      try {
        const redis = await getUwCacheRedis();
        if (redis) await seedUwCacheFromWsStores(redis);
      } catch {
        /* non-fatal */
      }

      console.log("[staging-boot-warm] desk lanes + SPX/SPY heatmap + bootstrap warmed");
    } catch (err) {
      console.warn("[staging-boot-warm] non-fatal:", err);
    }
  })();
}
