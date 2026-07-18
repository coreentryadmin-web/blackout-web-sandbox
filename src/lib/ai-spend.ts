// Pure, alias-free AI-spend accounting for Anthropic calls. No @/lib imports so it
// is unit-testable under `npx tsx --test` (mirrors et-window.ts / safe-time.ts).
// estimateCostUsd is a pure function; SpendTracker is a tiny per-process accumulator
// keyed by ET calendar day that reports whether a USD threshold was JUST crossed.
//
// CAVEAT (multi-replica): the running total is PER PROCESS. Under multiple ECS
// replicas each tracks its own slice of spend, so the alert fires per-replica and the
// true org-wide daily total is the SUM across replicas. Acceptable for a first-pass
// tripwire; a durable cross-replica total would need Redis/Postgres.

export type AnthropicUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

type Price = { input: number; output: number }; // USD per 1M tokens

// Prices per the claude-api skill 'Current Models' table (cached 2026-06-04).
// Unknown models are intentionally absent — estimateCostUsd returns null for them
// so the telemetry path no-ops rather than guessing a wrong number.
const PRICES: Record<string, Price> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Cache multipliers relative to base input price (5-minute ephemeral TTL).
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

export function isKnownModel(model: string): boolean {
  return model in PRICES;
}

/**
 * Estimate the USD cost of a single Anthropic response from its usage block.
 * Returns null when the model is unknown OR usage is missing — callers MUST treat
 * null as "skip" (no-op the telemetry), never as 0.
 */
export function estimateCostUsd(model: string, usage: AnthropicUsage | null | undefined): number | null {
  if (!usage) return null;
  const price = PRICES[model];
  if (!price) return null;

  const input = Math.max(0, usage.input_tokens ?? 0);
  const output = Math.max(0, usage.output_tokens ?? 0);
  const cacheWrite = Math.max(0, usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Math.max(0, usage.cache_read_input_tokens ?? 0);

  const perTokenIn = price.input / 1_000_000;
  const perTokenOut = price.output / 1_000_000;

  return (
    input * perTokenIn +
    output * perTokenOut +
    cacheWrite * perTokenIn * CACHE_WRITE_MULT +
    cacheRead * perTokenIn * CACHE_READ_MULT
  );
}

/** YYYY-MM-DD in America/New_York for a given instant (DST-correct via Intl). */
export function etDayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type SpendRecord = {
  /** Cost added by this call (0 if model unknown / usage missing). */
  added: number;
  /** Running per-process total for the current ET day AFTER adding this call. */
  dayTotal: number;
  /** ET day key the total belongs to. */
  day: string;
  /** True exactly once: when this call pushed the day total from below to >= threshold. */
  thresholdJustCrossed: boolean;
  /** The threshold in effect for this record. */
  threshold: number;
};

/**
 * Per-process daily spend accumulator. Resets automatically when the ET day rolls
 * over. `record` returns thresholdJustCrossed=true on the single call that takes the
 * day total from < threshold to >= threshold; every later call that day returns false
 * (alert-once). estimateCost is injectable for testing; defaults to estimateCostUsd.
 */
export class SpendTracker {
  private day: string | null = null;
  private total = 0;
  private alerted = false;
  private readonly threshold: number;
  private readonly estimate: (model: string, usage: AnthropicUsage | null | undefined) => number | null;

  constructor(opts?: {
    thresholdUsd?: number;
    estimate?: (model: string, usage: AnthropicUsage | null | undefined) => number | null;
  }) {
    this.threshold = opts?.thresholdUsd ?? 50;
    this.estimate = opts?.estimate ?? estimateCostUsd;
  }

  record(model: string, usage: AnthropicUsage | null | undefined, now: Date = new Date()): SpendRecord {
    const day = etDayKey(now);
    if (day !== this.day) {
      this.day = day;
      this.total = 0;
      this.alerted = false;
    }

    const cost = this.estimate(model, usage);
    const added = cost ?? 0; // unknown model / missing usage => no-op
    const before = this.total;
    this.total += added;

    let thresholdJustCrossed = false;
    if (!this.alerted && before < this.threshold && this.total >= this.threshold && this.threshold > 0) {
      thresholdJustCrossed = true;
      this.alerted = true;
    }

    return {
      added,
      dayTotal: this.total,
      day,
      thresholdJustCrossed,
      threshold: this.threshold,
    };
  }

  /** Current per-process total for the active ET day (read-only). */
  get currentTotal(): number {
    return this.total;
  }
}
