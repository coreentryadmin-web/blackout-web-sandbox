/**
 * Client-side persistence + construction for Vector alert rules (in-page delivery, slice 1b). Kept
 * SEPARATE from the pure `vector-alerts` engine so the engine stays free of `window`/`Date.now` and
 * fully unit-testable; this module is the small localStorage shell the shell component uses.
 *
 * Rules are stored per ticker under `vector:alerts:<TICKER>`. All reads/writes are guarded so SSR
 * (no `window`) and quota/parse failures degrade to an empty rule set rather than throwing.
 */

import { alertRuleId, type AlertRule, type AlertKind } from "./vector-alerts";

const KEY_PREFIX = "vector:alerts:";
// Device-wide (not per-ticker): whether the member opted this browser into OS notifications for
// fired alerts. Permission itself lives in the browser; this only records the member's intent so we
// don't re-prompt or fire OS banners they didn't ask for.
const NOTIFY_KEY = "vector:notify-enabled";

function keyFor(ticker: string): string {
  return `${KEY_PREFIX}${ticker.toUpperCase()}`;
}

/** Whether the member enabled OS notifications on this device. Defaults false (opt-in). SSR-safe. */
export function loadNotifyEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the member's OS-notification opt-in for this device. Silent no-op on SSR / quota. */
export function saveNotifyEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
  } catch {
    /* quota / private-mode — best effort */
  }
}

/** Load the member's saved rules for a ticker. Returns [] on SSR / missing / malformed storage. */
export function loadAlertRules(ticker: string): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(ticker));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed rules — a schema drift or hand-edit can't crash the page.
    return parsed.filter(
      (r): r is AlertRule =>
        r && typeof r.id === "string" && typeof r.ticker === "string" &&
        (r.kind === "wall-touch" || r.kind === "flip-cross") && typeof r.enabled === "boolean"
    );
  } catch {
    return [];
  }
}

/** Persist the rules for a ticker. Silent no-op on SSR / quota errors. */
export function saveAlertRules(ticker: string, rules: readonly AlertRule[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(ticker), JSON.stringify(rules));
  } catch {
    /* quota / private-mode — best effort */
  }
}

/**
 * Append a new rule to the existing list, returning the new array. The id is stable and collision-
 * free within the ticker: seed = 1 + the max numeric suffix already present for this ticker+kind, so
 * removing then re-adding can't reuse a live id. Pure (no Date.now) — the seed comes from the list.
 */
export function buildAlertRule(
  existing: readonly AlertRule[],
  ticker: string,
  kind: AlertKind,
  tolerancePct?: number
): AlertRule {
  const prefix = `${ticker.toUpperCase()}:${kind}:`;
  let maxSeed = 0;
  for (const r of existing) {
    if (r.id.startsWith(prefix)) {
      const n = Number(r.id.slice(prefix.length));
      if (Number.isFinite(n) && n > maxSeed) maxSeed = n;
    }
  }
  return {
    id: alertRuleId(ticker.toUpperCase(), kind, maxSeed + 1),
    ticker: ticker.toUpperCase(),
    kind,
    enabled: true,
    ...(kind === "wall-touch" && tolerancePct != null ? { tolerancePct } : {}),
  };
}
