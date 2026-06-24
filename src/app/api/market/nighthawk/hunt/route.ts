import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { runDayTradeAgent } from "@/lib/nighthawk/agents";
import { getAgentConfig } from "@/lib/nighthawk/agent-config";
import { huntPlatformContext, runHuntScan } from "@/lib/nighthawk/hunt-builder";
import type { HuntMode, HuntRequest, HuntResponse } from "@/lib/nighthawk/types";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import {
  huntActiveKey,
  maxConcurrentHunts,
  HUNT_SLOT_TTL_S,
  HUNT_ACQUIRE_LUA,
  shouldRejectHunt,
} from "@/lib/nighthawk/hunt-concurrency";
import { requireToolApi } from "@/lib/tool-access-server";

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
  try {
    [scanResult, platform_context] = await Promise.all([
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
  } catch (error) {
    console.error("[nighthawk/hunt] error", { mode: body.mode, userId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunt scan failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    if (userId) await releaseHuntSlot(userId, slot.redis);
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
