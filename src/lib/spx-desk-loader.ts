import { deskCacheTtlMs, deskFlowCacheTtlMs, deskPulseCacheTtlMs } from "@/lib/providers/config";
import {
  buildSpxDesk,
  buildSpxDeskFlow,
  buildSpxDeskPulse,
} from "@/lib/providers/spx-desk";
import type { SpxDeskFlow, SpxDeskPayload, SpxDeskPulse } from "@/lib/providers/spx-desk";
import { mergeDeskLayers } from "@/lib/spx-desk-merge";
import { withServerCache } from "@/lib/server-cache";
import { todayEtYmd } from "@/lib/providers/spx-session";

export type MergedSpxDeskBundle = {
  desk: SpxDeskPayload;
  flow: SpxDeskFlow | null;
  pulse: SpxDeskPulse | null;
  merged: SpxDeskPayload;
};

/**
 * THE single cache lane for buildSpxDesk() — every consumer (this loader, the standalone
 * /api/market/spx/desk route) must call this function rather than invoking
 * withServerCache/buildSpxDesk directly, so there is exactly ONE cached desk snapshot per
 * session date across the whole app.
 *
 * Previously the standalone route cached buildSpxDesk() under a bare "spx-desk" key while
 * this loader used "spx-desk:${date}" — two independently-expiring 10s-TTL lanes racing a
 * live WS tide store. That let the member dashboard and the trade-alert panel disagree on
 * trade direction within the same refresh cycle: confirmed live (2026-07-01 14:19 UTC) as
 * identical VWAP/gamma-flip inputs but a different tide read 28 seconds apart — a member
 * could see a bullish header next to a short trade call on the same page. Never re-introduce
 * a second cache key for this builder; route every consumer through this function instead.
 */
export async function loadSpxDesk(): Promise<SpxDeskPayload> {
  // ISSUE-25: Include session date in the cache key so a process running across midnight
  // serves fresh data on the new session rather than stale prior-day data.
  const date = todayEtYmd();
  // SWR: return last good snapshot immediately while the background refresh runs.
  // Prevents a cold Massive chain fetch (20s+) from blocking play/desk polling.
  return withServerCache(`spx-desk:${date}`, deskCacheTtlMs(), buildSpxDesk, {
    staleWhileRevalidate: true,
  });
}

/**
 * THE single cache lane for buildSpxDeskPulse() — same contract as loadSpxDesk().
 * Standalone /api/market/spx/pulse must call this, not withServerCache directly.
 */
export async function loadSpxDeskPulse(): Promise<SpxDeskPulse> {
  const date = todayEtYmd();
  return withServerCache(`spx-desk-pulse:${date}`, deskPulseCacheTtlMs(), buildSpxDeskPulse);
}

/**
 * THE single cache lane for buildSpxDeskFlow() — same contract as loadSpxDesk().
 * Standalone /api/market/spx/flow must call this, not withServerCache directly.
 */
export async function loadSpxDeskFlow(): Promise<SpxDeskFlow> {
  const date = todayEtYmd();
  return withServerCache(`spx-desk-flow:${date}`, deskFlowCacheTtlMs(), buildSpxDeskFlow);
}

/** Single server path: cache lanes → merge pulse + flow into desk. */
export async function loadMergedSpxDesk(): Promise<MergedSpxDeskBundle> {
  const [desk, flow, pulse] = await Promise.all([
    loadSpxDesk(),
    loadSpxDeskFlow(),
    loadSpxDeskPulse(),
  ]);

  const merged = mergeDeskLayers(desk, flow, pulse);
  return { desk, flow, pulse, merged };
}
