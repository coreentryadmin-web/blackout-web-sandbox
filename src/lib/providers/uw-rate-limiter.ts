/** Global UW API throttle — token bucket + max concurrency. */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MAX_RPS = envNumber("UW_MAX_RPS", 2.5);
const MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("UW_MAX_CONCURRENCY", 4)));

let tokens = MAX_RPS;
let lastRefillMs = Date.now();
let inFlight = 0;

function refillTokens(): void {
  const now = Date.now();
  const elapsedSec = (now - lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  tokens = Math.min(MAX_RPS, tokens + elapsedSec * MAX_RPS);
  lastRefillMs = now;
}

function waitMsForToken(): number {
  refillTokens();
  if (tokens >= 1) return 0;
  const deficit = 1 - tokens;
  return Math.max(25, Math.ceil((deficit / MAX_RPS) * 1000));
}

async function acquireSlot(): Promise<void> {
  for (;;) {
    refillTokens();
    if (inFlight < MAX_CONCURRENCY && tokens >= 1) {
      tokens -= 1;
      inFlight += 1;
      return;
    }
    const delay = inFlight >= MAX_CONCURRENCY ? 50 : waitMsForToken();
    await new Promise((r) => setTimeout(r, delay));
  }
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}

/** Pace a single UW HTTP call through the global bucket. */
export async function throttleUw<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

export function uwRateLimiterStats(): { maxRps: number; maxConcurrency: number; inFlight: number; tokens: number } {
  refillTokens();
  return { maxRps: MAX_RPS, maxConcurrency: MAX_CONCURRENCY, inFlight, tokens };
}
