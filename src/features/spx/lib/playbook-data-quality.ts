import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { playGexStaleMaxSec } from "@/features/spx/lib/spx-play-config";

/** Event / breakout playbooks blocked on live gate when feeds are degraded. */
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

export function isDegradedForLivePlaybook(
  pbId: PlaybookId,
  flags: PlaybookDataQualityFlags
): boolean {
  if (!DEGRADED_FEED_LIVE_BLOCK_PLAYBOOKS.has(pbId)) return false;
  return flags.halt_channel_stale || flags.desk_stale;
}
