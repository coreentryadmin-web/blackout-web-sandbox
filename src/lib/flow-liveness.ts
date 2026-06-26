import { randomUUID } from "node:crypto";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

/**
 * Cluster-wide "the UW flow WebSocket is delivering frames" heartbeat.
 *
 * Problem (audit gap #10): flow-ingest gates its REST skip/run decision on the
 * LOCAL in-process uwSocket.getStatus(). On a multi-replica Railway deployment a
 * replica that serves only /flows traffic boots the WS and delivers frames, while
 * a DIFFERENT replica runs the flow-ingest cron — that cron's local socket is
 * CLOSED, so it cannot tell the cluster already has a live WS and runs REST
 * redundantly (extra UW calls + duplicate-insert churn).
 *
 * Fix: whichever replica actually delivers a WS flow frame writes a shared Redis
 * heartbeat; the cron reads it and skips REST when ANY replica delivered recently.
 *
 * Anti-self-skip: the heartbeat carries the writer's per-process instance id. The
 * cron only trusts it when written by a DIFFERENT instance (some OTHER replica is
 * delivering). A replica's own REST-path persist therefore can never satisfy its
 * own skip gate and silence itself.
 *
 * Fail-open: sharedCacheGet/Set degrade to an in-process memory map when Redis is
 * unavailable, so a single-process / Redis-down deployment falls back to the
 * caller's existing local getStatus() check (the memory copy is this same process,
 * so the different-instance guard returns "not fresh from elsewhere" and the
 * caller keeps its local behavior).
 *
 * Key matches the audit contract: `blackout:flow_alerts:last_delivered_at`
 * (sharedCacheSet prefixes `blackout:` for us).
 */
const HEARTBEAT_KEY = "flow_alerts:last_delivered_at";

// 90s TTL: comfortably longer than the WS frame cadence + the cron interval so a
// brief gap between frames doesn't expire the key, but short enough that a truly
// dead WS lets the key lapse and the cron resumes REST within ~1.5 min.
const HEARTBEAT_TTL_SEC = 90;

const INSTANCE_ID = randomUUID();

type HeartbeatRecord = { at: number; instance: string };

let lastWriteAt = 0;
// Throttle writes: WS can deliver many frames/sec; one Redis SET per frame is
// wasteful. One write per 5s keeps the heartbeat fresh without hammering Redis.
const WRITE_THROTTLE_MS = 5_000;

/**
 * Record that THIS replica just delivered a live UW flow frame. Best-effort and
 * never throws — a heartbeat write failure must never break flow persistence.
 * Throttled so high-frequency frame delivery does not spam Redis.
 */
export function markFlowFrameDelivered(now = Date.now()): void {
  if (now - lastWriteAt < WRITE_THROTTLE_MS) return;
  lastWriteAt = now;
  const record: HeartbeatRecord = { at: now, instance: INSTANCE_ID };
  void sharedCacheSet(HEARTBEAT_KEY, record, HEARTBEAT_TTL_SEC).catch(() => {
    /* best-effort; in-memory fallback already written by sharedCacheSet */
  });
}

/**
 * True when SOME OTHER replica delivered a WS flow frame within `maxAgeMs`.
 *
 * Returns false (not "fresh elsewhere") when:
 *  - Redis is unavailable (sharedCacheGet → in-memory copy, which is either empty
 *    on the cron replica or this same process's own write → instance matches →
 *    excluded), OR
 *  - the only recent writer is THIS process (self-skip guard), OR
 *  - no heartbeat exists / it is stale.
 *
 * In every false case the caller falls back to its existing local getStatus()
 * gate, so behavior is never worse than before. Never throws.
 */
export async function isFlowFrameFreshFromCluster(maxAgeMs = 120_000): Promise<boolean> {
  try {
    const record = await sharedCacheGet<HeartbeatRecord>(HEARTBEAT_KEY);
    if (!record || typeof record.at !== "number") return false;
    // A heartbeat written by THIS process must not let it skip its own REST work.
    if (record.instance === INSTANCE_ID) return false;
    return Date.now() - record.at <= maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Observability variant of {@link isFlowFrameFreshFromCluster} WITHOUT the
 * anti-self-skip instance guard: true when ANY replica — including this one —
 * delivered a live UW flow frame within `maxAgeMs`.
 *
 * Used by admin health to corroborate a per-replica "Flow data stale" reading
 * against cluster truth before escalating to CRITICAL. `flow_data_age_ms` is a
 * per-replica in-memory value (lastFlowDataAt); on a replica whose recent desk
 * builds returned no fresh SPX flow rows it reads stale even though the cluster
 * is delivering frames — a false critical that pages ops. The instance guard is
 * only meaningful for the cron's REST-skip decision, never for a freshness probe,
 * so it is dropped here.
 *
 * Fail-open: a genuine cluster-wide flow stall lets the heartbeat lapse (90s TTL)
 * → returns false → the caller's critical still fires (no real stall is masked).
 * Redis-down / no heartbeat → false → caller keeps its original behavior. Never
 * throws.
 */
export async function isFlowFrameFreshAnywhere(maxAgeMs = 120_000): Promise<boolean> {
  try {
    const record = await sharedCacheGet<HeartbeatRecord>(HEARTBEAT_KEY);
    if (!record || typeof record.at !== "number") return false;
    return Date.now() - record.at <= maxAgeMs;
  } catch {
    return false;
  }
}
