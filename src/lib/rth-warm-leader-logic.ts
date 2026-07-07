import { isFlowIngestAlternateWriterSkip } from "@/lib/cron-writer-target-fresh";

/** Expected max gap (minutes) before we proactively re-warm during RTH. */
export const RTH_WRITER_HEAL_AFTER_MIN: Record<string, number> = {
  "heatmap-warm": 2,
  /** 1.5 = 90s — tighter than other warmers; desk cold-build blocks are the top UX pain point. */
  "desk-warm": 1.5,
  "uw-cache-refresh": 4,
  "grid-warm": 4,
  "flow-ingest": 4,
};

/** Pure overdue logic — exported for unit tests without pulling cron route handlers. */
export function rthWriterOverdue(
  key: string,
  lastRunAt: string | null,
  lastStatus: string | null,
  lastMessage: string | null,
  nowMs = Date.now()
): boolean {
  const healAfterMin = RTH_WRITER_HEAL_AFTER_MIN[key];
  if (healAfterMin == null) return false;
  if (!lastRunAt) return true;

  if (
    key === "flow-ingest" &&
    lastStatus === "skipped" &&
    isFlowIngestAlternateWriterSkip(lastMessage)
  ) {
    return false;
  }

  const ageMin = (nowMs - new Date(lastRunAt).getTime()) / 60_000;
  return Number.isFinite(ageMin) && ageMin > healAfterMin;
}
