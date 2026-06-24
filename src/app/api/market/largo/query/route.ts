import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { largoConfigured, runLargoQuery, runLargoQueryStream, isSseClientDisconnect, SseClientDisconnected } from "@/lib/largo-terminal";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { largoBudgetKey, secondsUntilEtMidnight, largoDailyQueryBudget, isOverLargoBudget } from "@/lib/largo-budget";
import { aiSpendKey, aiSpendKillSwitchUsd, isOverAiSpendCeiling } from "@/lib/ai-spend-ledger";
import { LocalConcurrencyBackstop, largoLocalMaxConcurrent } from "@/lib/largo-local-gate";
import { requireToolApi } from "@/lib/tool-access-server";
import {
  LARGO_INFLIGHT_KEY,
  LARGO_INFLIGHT_ACQUIRE_LUA,
  largoGlobalMaxConcurrent,
  largoInflightTtlMs,
  inflightStaleCutoff,
} from "@/lib/largo-global-gate";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Largo concurrency gate — max 2 simultaneous queries per user, Redis-backed.
// Fails open (acquired = true) when Redis is unavailable so queries still work.
// ---------------------------------------------------------------------------

type GateRedis = {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string | number): Promise<"OK">;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<number>;
} | null;

const MAX_LARGO_CONCURRENT = 2;
const LARGO_TTL_S = 180; // 3 min — auto-expire stuck counters

// Process-local concurrency backstop. The per-user Redis gate below FAILS OPEN on Redis
// loss, which would let a premium surge uncork unbounded concurrent Claude tool-loops. This
// in-memory counter is consulted ONLY in the fail-open paths so a Redis outage degrades to
// (cap × replica count) instead of "unbounded"; with Redis healthy it is never touched and
// the per-user gate stays fully authoritative. See largo-local-gate.ts for the rationale.
const largoBackstop = new LocalConcurrencyBackstop(largoLocalMaxConcurrent());

type LargoSlot = { acquired: boolean; redis: GateRedis; localSlot: boolean };

// Atomic acquire: INCR + EXPIRE in one round-trip so a crash between the two can
// never leave a counter with no TTL (which would lock the user out until their
// next request re-applied expire) — LARGO-7. Returns the post-incr count.
const ACQUIRE_LUA =
  "local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return c";

// Fail-open fallback: no per-user Redis gate available, so admit iff the process-local
// backstop has a free slot. `localSlot` flags that a backstop reservation is held (release
// must give it back) and forces redis=null so downstream Redis ops correctly no-op.
function acquireViaBackstop(): LargoSlot {
  const ok = largoBackstop.tryAcquire();
  return { acquired: ok, redis: null, localSlot: ok };
}

async function acquireLargoSlot(userId: string): Promise<LargoSlot> {
  // getUwCacheRedis returns a minimal RedisClient type; cast to GateRedis so we
  // can call incr/decr/expire/eval which ioredis supports at runtime.
  const redis = (await getUwCacheRedis()) as GateRedis;
  if (!redis) return acquireViaBackstop(); // fail-open WITH local backstop: no Redis → no per-user gate

  const key = `largo:active:${userId}`;
  try {
    const count = Number(await redis.eval(ACQUIRE_LUA, 1, key, LARGO_TTL_S));
    if (count > MAX_LARGO_CONCURRENT) {
      await redis.decr(key);
      return { acquired: false, redis, localSlot: false };
    }
    return { acquired: true, redis, localSlot: false };
  } catch {
    // Redis error → fail-open, but still bounded by the local backstop
    return acquireViaBackstop();
  }
}

async function releaseLargoSlot(userId: string, redis: GateRedis, localSlot: boolean): Promise<void> {
  if (localSlot) largoBackstop.release(); // give back the in-memory reservation, if any
  if (!redis) return;
  const key = `largo:active:${userId}`;
  try {
    const val = await redis.decr(key);
    if (val < 0) await redis.set(key, 0); // clamp to 0 if it goes negative
  } catch {
    /* non-fatal — TTL will clean up the key within LARGO_TTL_S seconds */
  }
}

// ---------------------------------------------------------------------------
// Cross-replica GLOBAL concurrency ceiling (audit §3.7) — caps total simultaneous Largo queries
// across ALL users + replicas, on top of the per-user gate. Acquired AFTER the per-user gate so only
// queries that already passed per-user consume global capacity. Leak-safe ZSET (a crashed replica's
// reservation self-heals on the next acquire, see largo-global-gate.ts). FAILS OPEN on Redis loss —
// the per-process local backstop already bounds that path, so this ceiling only binds when Redis is
// healthy. Reuses the per-user gate's Redis handle: if that was null (fail-open), this is a no-op
// too, keeping both gates consistent on an outage.
// ---------------------------------------------------------------------------

type GlobalSlot = { acquired: boolean; reqId: string | null; redis: GateRedis };

async function acquireLargoGlobalSlot(redis: GateRedis): Promise<GlobalSlot> {
  if (!redis) return { acquired: true, reqId: null, redis }; // fail-open: no Redis → no global gate
  const reqId = randomUUID();
  const now = Date.now();
  const ttlMs = largoInflightTtlMs();
  try {
    const ok = Number(
      await redis.eval(
        LARGO_INFLIGHT_ACQUIRE_LUA,
        1,
        LARGO_INFLIGHT_KEY,
        inflightStaleCutoff(now, ttlMs),
        largoGlobalMaxConcurrent(),
        now,
        reqId,
        ttlMs
      )
    );
    if (ok === 1) return { acquired: true, reqId, redis };
    return { acquired: false, reqId: null, redis }; // at the org-wide cap
  } catch {
    return { acquired: true, reqId: null, redis }; // Redis error → fail-open (backstop bounds blast radius)
  }
}

async function releaseLargoGlobalSlot(slot: GlobalSlot): Promise<void> {
  if (!slot.redis || !slot.reqId) return; // nothing reserved (fail-open path)
  try {
    await slot.redis.zrem(LARGO_INFLIGHT_KEY, slot.reqId);
  } catch {
    /* non-fatal — a stranded reservation is pruned by the staleCutoff on the next acquire within TTL */
  }
}

// ---------------------------------------------------------------------------
// Largo per-user DAILY query budget — bounds unbounded cost exposure (audit P1).
// CHECK reads the daily counter (fail-open like the concurrency gate); RECORD
// atomically INCR+EXPIREs it (same Lua pattern) only AFTER a query runs so the
// daily key always carries a TTL. Cost is bounded because each query is itself
// cost-capped by anthropicToolLoop's maxRounds*maxTokens.
// ---------------------------------------------------------------------------

const BUDGET_INCR_LUA =
  "local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return c";

/** True when the user is OVER their daily cap and must be rejected. Fails OPEN
 * (false) when Redis is null or errors — identical semantics to acquireLargoSlot. */
async function isLargoBudgetExceeded(userId: string, redis: GateRedis): Promise<boolean> {
  if (!redis) return false; // fail-open: no Redis → no budget gate
  try {
    const raw = await redis.get(largoBudgetKey(userId));
    const count = Number(raw ?? 0);
    return isOverLargoBudget(count, largoDailyQueryBudget());
  } catch {
    return false; // Redis error → fail-open, never block on infra issues
  }
}

/** Records one consumed query against the user's daily budget. Best-effort: any
 * Redis null/error is swallowed (fail-open, never blocks the response). */
async function recordLargoBudgetUsage(userId: string, redis: GateRedis): Promise<void> {
  if (!redis) return;
  try {
    await redis.eval(BUDGET_INCR_LUA, 1, largoBudgetKey(userId), secondsUntilEtMidnight());
  } catch {
    /* non-fatal — under-counting one query is acceptable; never fail the request */
  }
}

// ---------------------------------------------------------------------------
// ORG-WIDE hard kill-switch — bounds total daily Anthropic spend across ALL users and
// replicas. Reads the cross-replica spend ledger (anthropic.ts writes it) and rejects new
// Largo queries once the org total is AT/over the absolute DAILY_AI_SPEND_KILL_USD ceiling.
// OPT-IN: disabled unless the env ceiling is set (see aiSpendKillSwitchUsd). Fails OPEN on
// Redis loss — the process-local concurrency backstop above bounds the outage blast radius.
// ---------------------------------------------------------------------------

/** True when the org-wide daily spend is AT/over the hard ceiling and new queries must be
 *  rejected. Returns false (allow) when the kill-switch is disabled or Redis is unreachable. */
async function isLargoKillSwitchTripped(): Promise<boolean> {
  const ceiling = aiSpendKillSwitchUsd();
  if (ceiling == null) return false; // kill-switch not armed → never blocks
  const redis = (await getUwCacheRedis()) as GateRedis;
  if (!redis) return false; // fail-open: no Redis → can't read the ledger (backstop bounds blast radius)
  try {
    const raw = await redis.get(aiSpendKey());
    return isOverAiSpendCeiling(Number(raw ?? 0), ceiling);
  } catch {
    return false; // Redis error → fail-open, never block on infra issues
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function wantsStream(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get("stream") === "1") return true;
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}

export async function POST(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  // Launch gate — Largo is locked to non-admins until it ships (every call spends Anthropic tokens).
  const locked = await requireToolApi("largo");
  if (locked) return locked;

  if (!largoConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on server" },
      { status: 503 }
    );
  }

  let body: { question?: string; session_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = String(body.question ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  if (question.length > 4000) {
    return NextResponse.json({ error: "question too long" }, { status: 400 });
  }

  const resolvedSessionId = sessionId || `web-${authResult.userId}-${Date.now()}`;

  // Org-wide kill-switch — checked FIRST (cheap GET, no side effects, holds no slot). If the
  // whole org has burned past the hard daily spend ceiling, reject before doing any work.
  if (await isLargoKillSwitchTripped()) {
    return NextResponse.json(
      { error: "Largo is temporarily paused: the platform-wide daily AI spend limit has been reached. Try again after midnight ET." },
      { status: 503 }
    );
  }

  // Concurrency gate — max MAX_LARGO_CONCURRENT simultaneous queries per user.
  const userId = authResult.userId;
  const slot = await acquireLargoSlot(userId);
  if (!slot.acquired) {
    return NextResponse.json(
      { error: "Too many active Largo sessions. Please wait for a previous query to complete." },
      { status: 429 }
    );
  }

  // Org-wide concurrency ceiling — reject (releasing the per-user slot we just took) if the WHOLE
  // cluster is at capacity, so a premium surge can't fan out unbounded Claude tool-loops across
  // replicas. Acquired after the per-user gate; reuses its Redis handle so both fail open together.
  const globalSlot = await acquireLargoGlobalSlot(slot.redis);
  if (!globalSlot.acquired) {
    await releaseLargoSlot(userId, slot.redis, slot.localSlot);
    return NextResponse.json(
      { error: "Largo is at peak capacity right now. Please retry in a few seconds." },
      { status: 503 }
    );
  }

  // Daily budget gate — reject (and RELEASE both slots we just took) if the user has already
  // consumed their per-day query allowance. Fail-open inside. One check before BOTH branches.
  if (await isLargoBudgetExceeded(userId, slot.redis)) {
    await releaseLargoGlobalSlot(globalSlot);
    await releaseLargoSlot(userId, slot.redis, slot.localSlot);
    return NextResponse.json(
      { error: `Daily Largo query limit reached (${largoDailyQueryBudget()}/day). Try again after midnight ET.` },
      { status: 429 }
    );
  }

  if (wantsStream(req)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const markClosed = () => {
          closed = true;
        };
        req.signal.addEventListener("abort", markClosed, { once: true });

        const send = (payload: unknown): boolean => {
          if (closed || req.signal.aborted) {
            closed = true;
            return false;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            return true;
          } catch (err) {
            closed = true;
            if (!isSseClientDisconnect(err)) {
              console.warn("[market/largo/query stream] enqueue failed:", err);
            }
            return false;
          }
        };

        try {
          await runLargoQueryStream(question, resolvedSessionId, userId, (event) => {
            if (!send(event)) {
              closed = true;
              throw new SseClientDisconnected();
            }
          });
        } catch (error) {
          if (isSseClientDisconnect(error)) return;
          console.error("[market/largo/query stream]", error);
          send({ type: "error", message: error instanceof Error ? error.message : "Largo query failed" });
        } finally {
          closed = true;
          // Record one consumed query against the daily budget (best-effort, fail-open)
          // BEFORE releasing the concurrency slot. Recorded unconditionally: a started
          // query already incurred token cost, and this finally also runs on the
          // isSseClientDisconnect early return (a mid-stream hangup still ran the loop).
          await recordLargoBudgetUsage(userId, slot.redis);
          // Release both concurrency slots (global then per-user) before closing the controller.
          await releaseLargoGlobalSlot(globalSlot);
          await releaseLargoSlot(userId, slot.redis, slot.localSlot);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Connection: "keep-alive",
        Pragma: "no-cache",
      },
    });
  }

  try {
    const result = await runLargoQuery(question, resolvedSessionId, userId);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/largo/query]", error);
    const message = error instanceof Error ? error.message : "Largo query failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    // Record one consumed query against the daily budget (best-effort, fail-open), then release
    // both concurrency slots (global then per-user) whether the non-streaming query succeeded or
    // failed. Billing on success and failure alike is the conservative cost-control choice.
    await recordLargoBudgetUsage(userId, slot.redis);
    await releaseLargoGlobalSlot(globalSlot);
    await releaseLargoSlot(userId, slot.redis, slot.localSlot);
  }
}
