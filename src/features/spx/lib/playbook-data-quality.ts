import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { playGexStaleMaxSec } from "@/features/spx/lib/spx-play-config";
import { playbookDataQualityBlockReason } from "@/features/spx/lib/playbook-data-requirements";

/**
 * @deprecated Capability-based policy supersedes this set — see `playbook-data-requirements.ts`.
 * Retained for telemetry/docs references only.
 */
export const DEGRADED_FEED_LIVE_BLOCK_PLAYBOOKS: ReadonlySet<PlaybookId> = new Set([
  "PB-03",
  "PB-05",
  "PB-09",
  "PB-13",
  "PB-14",
]);

export type PlaybookDataQualityFlags = {
  halt_channel_stale: boolean;
  desk_stale: boolean;
  gex_missing: boolean;
};

/** Live posture derived from feed flags — drives global severe veto. */
export type LiveDataQualityMode = "normal" | "degraded" | "severe";

export function liveDataQualityMode(flags: PlaybookDataQualityFlags): LiveDataQualityMode {
  const issues = [flags.halt_channel_stale, flags.desk_stale, flags.gex_missing].filter(Boolean).length;
  if (issues >= 2) return "severe";
  if (issues >= 1) return "degraded";
  return "normal";
}

/** Fail-closed on live BUY when multiple feed dimensions are degraded simultaneously. */
export function shouldFailClosedLiveOnDataQuality(mode: LiveDataQualityMode): boolean {
  return mode === "severe";
}

export function playbookDataQualityFlags(desk: SpxDeskPayload): PlaybookDataQualityFlags {
  const polledAt = desk.polled_at ?? desk.as_of;
  const ageSec =
    polledAt != null
      ? Math.max(0, (Date.now() - new Date(polledAt).getTime()) / 1000)
      : Infinity;
  return {
    halt_channel_stale: desk.halt_channel_stale === true,
    desk_stale: ageSec > playGexStaleMaxSec(),
    gex_missing: !(desk.gex_walls?.length ?? 0),
  };
}

/** Capability-aware block — replaces hand-maintained degraded PB list. */
export function isDegradedForLivePlaybook(
  pbId: PlaybookId,
  flags: PlaybookDataQualityFlags,
  desk?: Pick<SpxDeskPayload, "vix"> | null
): boolean {
  return playbookDataQualityBlockReason(pbId, flags, desk) != null;
}
