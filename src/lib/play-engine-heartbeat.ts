export type PlayEngineTickSource = "cron" | "admin_live" | "evaluate";

let lastTickAt: string | null = null;
let lastSource: PlayEngineTickSource | null = null;
let tickCount = 0;

export function recordPlayEngineTick(source: PlayEngineTickSource): void {
  lastTickAt = new Date().toISOString();
  lastSource = source;
  tickCount += 1;
}

export function getPlayEngineHeartbeat() {
  const now = Date.now();
  const ageMs = lastTickAt ? now - new Date(lastTickAt).getTime() : null;
  return {
    last_tick_at: lastTickAt,
    last_source: lastSource,
    tick_count: tickCount,
    age_ms: ageMs,
    stale: ageMs != null && ageMs > 5 * 60_000,
    critical_stale: ageMs != null && ageMs > 10 * 60_000,
  };
}
