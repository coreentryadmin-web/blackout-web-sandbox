// Pure, alias-free PROCESS-LOCAL backstop for the Largo gates. No @/lib imports so the
// math is unit-testable under `tsx --test` (mirrors largo-budget.ts / hunt-concurrency.ts).
//
// WHY this exists: the Redis-backed per-user concurrency gate (max 2) and daily budget both
// FAIL OPEN on Redis loss (no Redis -> no gate; see largo/query/route.ts). So a Redis outage
// during a premium surge can uncork UNBOUNDED concurrent Claude tool-loops on every replica,
// with no spend alert. This module is a Redis-INDEPENDENT second line of defence: a per-process
// counter of in-flight Largo queries that the route consults ONLY in the fail-open path, so an
// outage degrades concurrency to (cap × replica count) instead of "unbounded".
//
// It deliberately does NOT replace the per-user gate — when Redis is healthy the per-user gate
// stays fully authoritative and this counter is not consulted. It is a backstop, not a limiter.

/** Default per-process cap on simultaneous fail-open Largo queries when LARGO_LOCAL_MAX_CONCURRENT
 *  is unset/invalid. Conservative multiple of the per-user cap (2): enough headroom that a brief
 *  blip serving a few distinct users isn't throttled, low enough to bound a full-outage surge. */
export const DEFAULT_LARGO_LOCAL_MAX_CONCURRENT = 6;

/** Read the env cap; falls back to the default for unset / non-numeric / <=0 values. */
export function largoLocalMaxConcurrent(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LARGO_LOCAL_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LARGO_LOCAL_MAX_CONCURRENT;
}

/**
 * In-memory active-query counter with a hard cap. One instance per process (the route holds a
 * module-level singleton). `tryAcquire` reserves a slot iff under the cap; the caller MUST call
 * `release` exactly once for every successful acquire (the route does this in its finally block).
 * No TTL/auto-expiry is needed: the counter lives only as long as the in-flight requests it counts,
 * and a process crash resets it to 0 — strictly fail-safe (never strands a phantom reservation).
 */
export class LocalConcurrencyBackstop {
  private active = 0;
  private readonly cap: number;

  constructor(cap: number = DEFAULT_LARGO_LOCAL_MAX_CONCURRENT) {
    this.cap = Math.max(1, Math.floor(cap));
  }

  /** Reserve a slot. Returns true (caller now owns a slot, MUST release) or false if at cap. */
  tryAcquire(): boolean {
    if (this.active >= this.cap) return false;
    this.active++;
    return true;
  }

  /** Release a previously acquired slot. Clamped at 0 so a stray/double release can't go negative. */
  release(): void {
    if (this.active > 0) this.active--;
  }

  /** Current in-flight reservations (read-only). */
  get activeCount(): number {
    return this.active;
  }

  /** The hard cap in effect (read-only). */
  get capacity(): number {
    return this.cap;
  }
}
