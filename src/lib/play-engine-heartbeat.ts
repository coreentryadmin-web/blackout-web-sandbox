import { dbConfigured, getMeta, setMeta } from "@/lib/db";

export type PlayEngineTickSource = "cron" | "admin_live" | "evaluate";

const HEARTBEAT_META_KEY = "spx_play_engine_heartbeat";

let lastTickAt: string | null = null;
let lastSource: PlayEngineTickSource | null = null;
let tickCount = 0;

// EDGE-11 fix: record the moment this process started so the admin panel can
// distinguish "0 ticks since the last deploy" from "this engine has never
// ticked". The value is stable for the lifetime of the process.
const processStartedAt = new Date().toISOString();

// EDGE-11 fix: track whether we have already hydrated tickCount from the DB
// after startup so recordPlayEngineTick() picks up the persisted value before
// incrementing rather than starting from 0.
let initialized = false;

type HeartbeatPayload = {
  last_tick_at: string;
  last_source: PlayEngineTickSource;
  tick_count: number;
  last_restart_at?: string;
};

function buildHeartbeat() {
  const now = Date.now();
  const ageMs = lastTickAt ? now - new Date(lastTickAt).getTime() : null;
  return {
    last_tick_at: lastTickAt,
    last_source: lastSource,
    tick_count: tickCount,
    last_restart_at: processStartedAt,
    age_ms: ageMs,
    stale: ageMs != null && ageMs > 5 * 60_000,
    critical_stale: ageMs != null && ageMs > 10 * 60_000,
  };
}

function applyHeartbeatPayload(payload: HeartbeatPayload): void {
  lastTickAt = payload.last_tick_at;
  lastSource = payload.last_source;
  tickCount = payload.tick_count;
}

// EDGE-11 fix: read the last persisted tick_count from the DB so that after a
// restart we continue from the stored value instead of resetting to 0.
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true; // mark eagerly so concurrent callers don't double-read
  if (!dbConfigured()) return;
  try {
    const raw = await getMeta(HEARTBEAT_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HeartbeatPayload;
      if (parsed.last_tick_at) applyHeartbeatPayload(parsed);
    }
  } catch (err) {
    console.warn("[play-engine-heartbeat] init hydration failed:", err);
  }
}

export async function recordPlayEngineTick(source: PlayEngineTickSource): Promise<void> {
  // EDGE-11 fix: hydrate from DB before the first increment so the count is
  // continuous across process restarts.
  await ensureInitialized();

  lastTickAt = new Date().toISOString();
  lastSource = source;
  tickCount += 1;

  if (!dbConfigured()) return;

  const payload: HeartbeatPayload = {
    last_tick_at: lastTickAt,
    last_source: source,
    tick_count: tickCount,
    last_restart_at: processStartedAt,
  };

  try {
    await setMeta(HEARTBEAT_META_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[play-engine-heartbeat] persist failed:", err);
  }
}

/** Load heartbeat from DB (cross-replica) with in-memory read-through cache. */
export async function loadPlayEngineHeartbeat() {
  if (dbConfigured()) {
    try {
      const raw = await getMeta(HEARTBEAT_META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as HeartbeatPayload;
        if (parsed.last_tick_at) applyHeartbeatPayload(parsed);
      }
    } catch (err) {
      console.warn("[play-engine-heartbeat] load failed:", err);
    }
  }
  return buildHeartbeat();
}

/** Sync read of in-process cache — prefer loadPlayEngineHeartbeat for admin health. */
export function getPlayEngineHeartbeat() {
  return buildHeartbeat();
}
