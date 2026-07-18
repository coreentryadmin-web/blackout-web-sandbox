/**
 * In-process RTH warm leader — backup when ECS scheduled tasks stall.
 *
 * ECS scheduled tasks (hit-cron.mjs) can stop firing on schedule after redeploys
 * (#90-class silent death). The staleness watchdog self-heals every 20m, but critical
 * warmers need sub-5m cadence — EventBridge's native cron floor is 5 minutes, not 1.
 *
 * One cluster leader (Redis SETNX) polls cron_job_runs every 60s during the extended warm
 * window (4 AM–8 PM ET weekdays — isEtExtendedWarmHours, wider than cash RTH on purpose: this
 * loop runs inside the always-on web server process, not an EventBridge-scheduled task, so it's
 * the one lever that can keep caches warm through pre-market/after-hours browsing without any
 * ECS config change — see FINDINGS.md 2026-07-06) and dispatches idempotent warmers via
 * dispatchCronWarm when a writer is overdue (desk-warm: 90s).
 */
import { CRON_JOBS } from "@/lib/cron-registry";
import { dispatchCronWarm, isDispatchableCron } from "@/lib/cron-dispatch";
import { isEtExtendedWarmHours } from "@/lib/et-market-hours";
import { dbConfigured, fetchCronJobLastRuns } from "@/lib/db";
import { RTH_WRITER_HEAL_AFTER_MIN, rthWriterOverdue } from "@/lib/rth-warm-leader-logic";
import {
  alertWsLeaderFailClosedOnce,
  clearWsLeaderFailClosedAlert,
  wsLeaderShouldFailOpenWithoutRedis,
} from "@/lib/ws/leader-lock-shared";
import { newLockToken, releaseFencedLock, renewFencedLock, type FencedRedis } from "@/lib/ws/leader-lock-fencing";

const LEADER_KEY = "rth:warm:leader";
const LEADER_TTL_SEC = 45;
const TICK_MS = 60_000;

const WATCH_KEYS = Object.keys(RTH_WRITER_HEAL_AFTER_MIN).filter(isDispatchableCron);

type IoredisLockExtra = FencedRedis & {
  set(k: string, v: string, ex: string, ttl: number, nx: string): Promise<string | null>;
};

// Random per-process identity for this lock — see leader-lock-fencing.ts for why a plain SETNX
// with unconditional EXPIRE/DEL renewal can split-brain across two replicas.
const RTH_LOCK_TOKEN = newLockToken();

let started = false;
let isLeader = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let leaderRefreshTimer: ReturnType<typeof setInterval> | null = null;
const inFlight = new Set<string>();

async function getLockRedis(): Promise<IoredisLockExtra | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    const { makeRedis } = await import("./make-redis");
    const client = await makeRedis("rth-warm-leader", url, { maxRetriesPerRequest: 1 });
    return client as unknown as IoredisLockExtra;
  } catch {
    return null;
  }
}

async function tryAcquireLead(): Promise<boolean> {
  try {
    const redis = await getLockRedis();
    if (!redis) {
      if (!wsLeaderShouldFailOpenWithoutRedis()) {
        alertWsLeaderFailClosedOnce("rth-warm-leader");
        return false; // multi-replica, Redis down — fail closed to avoid N-way cron-warm contention
      }
      return true; // single replica — safe to fail open, no contention possible
    }
    clearWsLeaderFailClosedAlert("rth-warm-leader");
    const result = await redis.set(LEADER_KEY, RTH_LOCK_TOKEN, "EX", LEADER_TTL_SEC, "NX");
    return result === "OK";
  } catch {
    if (!wsLeaderShouldFailOpenWithoutRedis()) {
      alertWsLeaderFailClosedOnce("rth-warm-leader");
      return false;
    }
    return true; // single replica — safe to fail open even on a Redis error
  }
}

function startLeaderRefresh(): void {
  if (leaderRefreshTimer) return;
  leaderRefreshTimer = setInterval(() => {
    if (!isLeader) return;
    void getLockRedis()
      .then(async (redis) => {
        if (!redis) return;
        const stillMine = await renewFencedLock(redis, LEADER_KEY, RTH_LOCK_TOKEN, LEADER_TTL_SEC);
        if (!stillMine) {
          // Another replica already won this lock (we stalled past the TTL) — stand down instead
          // of re-arming a lease we no longer hold. The next tick() re-attempts acquisition.
          console.warn("[rth-warm-leader] lost cluster lead to another replica (stalled past TTL) — standing down");
          isLeader = false;
        }
      })
      .catch(() => undefined);
  }, 15_000);
  (leaderRefreshTimer as unknown as { unref?: () => void }).unref?.();
}

function releaseLead(): void {
  isLeader = false;
  if (leaderRefreshTimer) {
    clearInterval(leaderRefreshTimer);
    leaderRefreshTimer = null;
  }
  void getLockRedis()
    .then((redis) => redis && releaseFencedLock(redis, LEADER_KEY, RTH_LOCK_TOKEN))
    .catch(() => undefined);
}

async function tick(): Promise<void> {
  if (!isEtExtendedWarmHours()) return;
  if (!dbConfigured()) return;
  if (!process.env.CRON_SECRET?.trim()) return;

  if (!isLeader) {
    isLeader = await tryAcquireLead();
    if (!isLeader) return;
    startLeaderRefresh();
    console.log("[rth-warm-leader] acquired cluster lead — backing up stalled ECS scheduled tasks");
  }

  const jobByKey = Object.fromEntries(CRON_JOBS.map((j) => [j.key, j]));
  const lastByKey = Object.fromEntries(
    (await fetchCronJobLastRuns()).map((r) => [r.job_key, r])
  );

  for (const key of WATCH_KEYS) {
    if (!jobByKey[key]?.market_hours_only) continue;
    const last = lastByKey[key];
    const overdue = rthWriterOverdue(
      key,
      last?.started_at ?? null,
      last?.status ?? null,
      last?.message ?? null
    );
    if (!overdue || inFlight.has(key)) continue;

    inFlight.add(key);
    try {
      const res = await dispatchCronWarm(key);
      console[res.ok ? "warn" : "error"](
        `[rth-warm-leader] backup warm '${key}' ${res.ok ? "ok" : "FAILED"} (${res.durationMs}ms)${
          res.error || res.detail ? ` — ${res.error ?? res.detail}` : ""
        }`
      );
    } finally {
      inFlight.delete(key);
    }
  }
}

/** Boot the RTH warm leader tick (idempotent). Called from ensureDataSockets. */
export function ensureRthWarmLeader(): void {
  if (started) return;
  if (process.env.RTH_WARM_LEADER?.trim() === "0") return;
  started = true;

  const runTick = () => {
    void tick().catch((err) => {
      console.error("[rth-warm-leader] tick error:", err instanceof Error ? err.message : err);
    });
  };

  runTick();
  tickTimer = setInterval(runTick, TICK_MS);
  (tickTimer as unknown as { unref?: () => void }).unref?.();

  if (typeof process !== "undefined" && typeof process.once === "function") {
    const onSignal = () => releaseLead();
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  }
}
