/**
 * Shared cross-replica WS leader-lock fail-open/fail-closed policy.
 *
 * uw-socket.ts, polygon-socket.ts, options-socket.ts, and stocks-socket.ts each hold a Redis
 * SETNX lock so only ONE replica opens the upstream WebSocket (Massive/UW allow at most one live
 * connection per API key — the 2nd-Nth get rejected and churn reconnect loops). All four
 * previously failed OPEN unconditionally on missing/errored Redis ("single-replica safe"
 * comments), which is only true when REPLICA_COUNT<=1: on the real 5-replica production
 * topology, a Redis outage would make every replica think it's the leader simultaneously,
 * turning a transient Redis blip into a cluster-wide WS reconnect storm for the whole outage
 * window — worse than one replica briefly serving no live WS while REST/Redis-snapshot
 * fallbacks (which every one of these sockets already has) cover the gap.
 */
import { rateLimiterEnvNumber } from "@/lib/providers/provider-rate-limiter-shared";

export const REPLICA_COUNT = Math.max(1, Math.floor(rateLimiterEnvNumber("REPLICA_COUNT", 1)));

/**
 * Whether a WS leader-lock acquisition should fail OPEN (this replica proceeds to open the
 * socket) when Redis is unavailable. Single-replica is always safe — there is no peer to
 * contend with. Multi-replica must fail CLOSED to avoid the N-way contention described above.
 * Takes `replicaCount` as a parameter (defaulting to the live env-derived REPLICA_COUNT) so it's
 * unit-testable against both topologies without reloading the module.
 */
export function wsLeaderShouldFailOpenWithoutRedis(replicaCount: number = REPLICA_COUNT): boolean {
  return replicaCount <= 1;
}

const failClosedAlerted = new Set<string>();

/**
 * Page ops once per socket when a multi-replica deployment fails CLOSED on a WS leader lock
 * because Redis is unavailable — mirrors uw-rate-limiter.ts's alertRedisDegradedOnce. Re-armed
 * by clearWsLeaderFailClosedAlert() on the next successful lock read so a later re-degrade
 * alerts again.
 */
export function alertWsLeaderFailClosedOnce(socketLabel: string): void {
  if (failClosedAlerted.has(socketLabel)) return;
  failClosedAlerted.add(socketLabel);
  void import("@/features/spx/lib/spx-play-notify")
    .then(({ notifyOpsDiscord }) =>
      notifyOpsDiscord({
        title: `${socketLabel} WS leader lock DEGRADED — Redis unavailable, failing closed`,
        body:
          `REPLICA_COUNT=${REPLICA_COUNT} and Redis is unreachable, so this replica is standing ` +
          `down instead of racing peers for the single upstream WebSocket slot (failing open here ` +
          `would have every replica try to open it and churn reconnects cluster-wide). Live data ` +
          `falls back to REST/cached snapshot until Redis recovers.`,
        severity: "warning",
      })
    )
    .catch(() => {
      failClosedAlerted.delete(socketLabel); // alert never delivered — allow a later retry
    });
}

/** Re-arm the fail-closed alert for a socket once its leader-lock read succeeds again. */
export function clearWsLeaderFailClosedAlert(socketLabel: string): void {
  failClosedAlerted.delete(socketLabel);
}
