import {
  isHaltStillActive,
  pruneExpiredHalts,
  type StoredTradingHalt,
} from "@/lib/ws/trading-halts-expiry";
import { LULD_INDEX_PROXIES } from "@/lib/live-api-integrations";
import type { TradingHaltEvent } from "@/lib/providers/unusual-whales";

const LULD_HALT_MAX_AGE_MS = 30 * 60_000;

export const luldHaltsStore: {
  halts: Map<string, StoredTradingHalt>;
  updatedAt: number;
  last_message_at: number;
} = {
  halts: new Map(),
  updatedAt: 0,
  last_message_at: 0,
};

export function touchLuldMessageAt(at = Date.now()): void {
  luldHaltsStore.last_message_at = at;
}

export function applyLuldHaltEvents(
  events: Array<{ symbol: string; active: boolean | null; indicator: number; ts: number }>
): void {
  if (!events.length) return;
  const now = Date.now();
  touchLuldMessageAt(now);
  for (const ev of events) {
    if (ev.active == null) continue;
    const sym = ev.symbol.toUpperCase();
    if (ev.active) {
      luldHaltsStore.halts.set(sym, {
        symbol: sym,
        halt_type: `luld:${ev.indicator}`,
        reason: "Massive LULD",
        halted_at: new Date(ev.ts).toISOString(),
        active: true,
        receivedAt: now,
      });
    } else {
      luldHaltsStore.halts.delete(sym);
    }
  }
  luldHaltsStore.updatedAt = now;
}

export function hasActiveLuldHalt(symbols: readonly string[]): boolean {
  pruneExpiredHalts(luldHaltsStore.halts, Date.now(), LULD_HALT_MAX_AGE_MS);
  const watch = new Set(symbols.map((s) => s.toUpperCase()));
  for (const [proxy, targets] of Object.entries(LULD_INDEX_PROXIES)) {
    const halt = luldHaltsStore.halts.get(proxy);
    if (
      halt &&
      isHaltStillActive(halt, Date.now(), LULD_HALT_MAX_AGE_MS) &&
      (watch.has(proxy) || targets.some((t) => watch.has(t)))
    ) {
      return true;
    }
  }
  for (const sym of Array.from(luldHaltsStore.halts.keys())) {
    const halt = luldHaltsStore.halts.get(sym);
    if (halt && isHaltStillActive(halt, Date.now(), LULD_HALT_MAX_AGE_MS) && watch.has(sym)) {
      return true;
    }
  }
  return false;
}

export function getActiveLuldHalts(symbols: readonly string[]): TradingHaltEvent[] {
  pruneExpiredHalts(luldHaltsStore.halts, Date.now(), LULD_HALT_MAX_AGE_MS);
  const watch = new Set(symbols.map((s) => s.toUpperCase()));
  const out: TradingHaltEvent[] = [];
  for (const halt of luldHaltsStore.halts.values()) {
    if (!isHaltStillActive(halt, Date.now(), LULD_HALT_MAX_AGE_MS)) continue;
    const sym = halt.symbol;
    const proxyTargets = LULD_INDEX_PROXIES[sym];
    const direct = watch.has(sym);
    const proxied = proxyTargets?.some((t) => watch.has(t)) ?? false;
    if (!direct && !proxied) continue;
    out.push({
      symbol: proxied && proxyTargets?.length ? `${proxyTargets.join("/")}←${sym}` : sym,
      halt_type: halt.halt_type,
      reason: halt.reason,
      halted_at: halt.halted_at,
      active: true,
    });
  }
  return out;
}

/** True when the LULD socket has not delivered within maxAgeMs (feed unavailable). */
export function isLuldHaltFeedStale(maxAgeMs: number, enabled: boolean): boolean {
  if (!enabled) return true;
  const at = luldHaltsStore.last_message_at;
  return at <= 0 || Date.now() - at > maxAgeMs;
}
