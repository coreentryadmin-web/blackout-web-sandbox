import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { runDayTradeAgent } from "@/features/nighthawk/lib/agents";
import { getAgentConfig } from "@/features/nighthawk/lib/agent-config";
import { huntPlatformContext, runHuntScan } from "@/features/nighthawk/lib/hunt-builder";
import type { HuntMode, HuntRequest, HuntResponse } from "@/features/nighthawk/lib/types";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import {
  huntActiveKey,
  maxConcurrentHunts,
  HUNT_SLOT_TTL_S,
  HUNT_ACQUIRE_LUA,
  shouldRejectHunt,
} from "@/features/nighthawk/lib/hunt-concurrency";
import {
  HUNT_INFLIGHT_KEY,
  HUNT_INFLIGHT_ACQUIRE_LUA,
  huntGlobalMaxConcurrent,
  huntInflightTtlMs,
  huntInflightStaleCutoff,
} from "@/features/nighthawk/lib/hunt-global-gate";
import { randomUUID } from "node:crypto";
import { requireToolApi } from "@/lib/tool-access-server";
import { runWithUwHuntBudget } from "@/lib/providers/uw-hunt-budget";

// ---------------------------------------------------------------------------
// Per-user hunt concurrency gate — Redis-backed, mirrors market/largo/query's
// acquireLargoSlot. Bounds the cost/CPU of fanning out runDayTradeAgent /
// runHuntScan + huntPlatformContext (each an expensive multi-provider scan).
// Fails OPEN (acquired) when Redis is unavailable so hunts never break on infra.
// Cron callers (userId === null) bypass the gate — they are internal/trusted and
// have no per-user identity to key on.
// ---------------------------------------------------------------------------

type GateRedis = {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string | number): Promise<"OK">;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<number>;
} | null;

async function acquireHuntSlot(userId: string): Promise<{ acquired: boolean; redis: GateRedis }> {
  const redis = (await getUwCacheRedis()) as GateRedis;
  if (!redis) return { acquired: true, redis: null }; // fail-open: no Redis → no gate
  const key = huntActiveKey(userId);
  try {
    const count = Number(await redis.eval(HUNT_ACQUIRE_LUA, 1, key, HUNT_SLOT_TTL_S));
    if (shouldRejectHunt(count, maxConcurrentHunts())) {
      await redis.decr(key);
      return { acquired: false, redis };
    }
    return { acquired: true, redis };
  } catch {
    return { acquired: true, redis: null }; // Redis error → fail-open
  }
}

async function releaseHuntSlot(userId: string, redis: GateRedis): Promise<void> {
  if (!redis) return;
  const key = huntActiveKey(userId);
  try {
    const val = await redis.decr(key);
    if (val < 0) await redis.set(key, 0); // clamp to 0 if it goes negative
  } catch {
    /* non-fatal — TTL cleans up the key within HUNT_SLOT_TTL_S seconds */
  }
}

// Cross-replica GLOBAL hunt ceiling — acquired after per-user gate (mirrors largo/query).
type HuntGlobalSlot = { acquired: boolean; reqId: string | null; redis: GateRedis };

async function acquireHuntGlobalSlot(redis: GateRedis): Promise<HuntGlobalSlot> {
  if (!redis) return { acquired: true, reqId: null, redis };
  const reqId = randomUUID();
  const now = Date.now();
  const ttlMs = huntInflightTtlMs();
  try {
    const ok = Number(
      await redis.eval(
        HUNT_INFLIGHT_ACQUIRE_LUA,
        1,
        HUNT_INFLIGHT_KEY,
        huntInflightStaleCutoff(now, ttlMs),
        huntGlobalMaxConcurrent(),
        now,
        reqId,
        ttlMs
      )
    );
    if (ok === 1) return { acquired: true, reqId, redis };
    return { acquired: false, reqId: null, redis };
  } catch {
    return { acquired: true, reqId: null, redis };
  }
}

async function releaseHuntGlobalSlot(slot: HuntGlobalSlot): Promise<void> {
  if (!slot.redis || !slot.reqId) return;
  try {
    await slot.redis.zrem(HUNT_INFLIGHT_KEY, slot.reqId);
  } catch {
    /* non-fatal — stale reservations are pruned on the next acquire */
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALID_MODES: HuntMode[] = ["day", "swing", "leap"];

export async function POST(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  let body: HuntRequest;
  try {
    body = (await req.json()) as HuntRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.mode || !VALID_MODES.includes(body.mode)) {
    return NextResponse.json({ error: "Invalid hunt mode" }, { status: 400 });
  }

  const config = getAgentConfig(body.mode);
  const filters = body.filters ?? {};

  console.info("[nighthawk/hunt] start", {
    mode: body.mode,
    filters,
    userId: authResult.userId,
  });

  // Per-user concurrency gate — only for signed-in users; cron callers bypass it.
  const userId = authResult.userId;
  const slot = userId ? await acquireHuntSlot(userId) : { acquired: true, redis: null as GateRedis };
  if (!slot.acquired) {
    return NextResponse.json(
      { error: "Too many active hunts. Please wait for a previous hunt to complete." },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }

  const globalSlot = userId ? await acquireHuntGlobalSlot(slot.redis) : { acquired: true, reqId: null, redis: slot.redis };
  if (!globalSlot.acquired) {
    if (userId) await releaseHuntSlot(userId, slot.redis);
    return NextResponse.json(
      { error: "Hunt capacity is full cluster-wide. Please try again shortly." },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }

  let scanResult: {
    ok: boolean;
    plays: HuntResponse["plays"];
    message: string;
    candidates: number;
    error?: string;
    duration_ms: number;
    spx_bias: "bull" | "bear" | "neutral" | null;
  };
  let platform_context: Awaited<ReturnType<typeof huntPlatformContext>>;

  // The whole per-user hunt scan runs inside a live-UW budget so it READS warmed
  // caches and can make at most a small handful of genuine live UW calls — it can
  // never drain the shared 2-RPS limiter or trip the breaker for the live SPX desk
  // (cache-reader rule). Cron callers (userId === null) run UNCAPPED: they are the
  // trusted off-peak warmers and the nightly edition needs full data fidelity.
  const runScan = (): Promise<readonly [typeof scanResult, typeof platform_context]> =>
    Promise.all([
      body.mode === "day"
        ? runDayTradeAgent({ mode: "day", filters }).then((run) => ({
            ok: run.ok,
            plays: run.signals,
            message: run.message,
            candidates: run.candidates,
            error: run.error,
            duration_ms: run.duration_ms,
            spx_bias: run.spx_bias ?? null,
          }))
        : runHuntScan(body).then((scan) => ({ ...scan, spx_bias: null })),
      huntPlatformContext(),
    ]);

  try {
    [scanResult, platform_context] = userId
      ? await runWithUwHuntBudget(runScan)
      : await runScan();
  } catch (error) {
    console.error("[nighthawk/hunt] error", { mode: body.mode, userId, error });
    return NextResponse.json(
      { error: "Hunt scan failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    if (userId) {
      await releaseHuntGlobalSlot(globalSlot);
      await releaseHuntSlot(userId, slot.redis);
    }
  }

  const response: HuntResponse = {
    status: scanResult.ok ? "complete" : "error",
    mode: body.mode,
    scanned_at: new Date().toISOString(),
    message: scanResult.ok
      ? scanResult.message
      : scanResult.message || `${config.title} hunt finished without qualifying plays.`,
    plays: scanResult.plays,
    platform_context: {
      ...platform_context,
      spx_bias: scanResult.spx_bias ?? null,
    },
    scan_meta: {
      candidates: scanResult.candidates,
      duration_ms: scanResult.duration_ms,
    },
  };

  console.info("[nighthawk/hunt] done", {
    mode: body.mode,
    ok: scanResult.ok,
    plays: scanResult.plays.length,
    candidates: scanResult.candidates,
    duration_ms: scanResult.duration_ms,
    spx_bias: scanResult.spx_bias,
    userId: authResult.userId,
  });

  return NextResponse.json(response, {
    status: scanResult.ok ? 200 : 422,
    headers: { "Cache-Control": "no-store" },
  });
}
