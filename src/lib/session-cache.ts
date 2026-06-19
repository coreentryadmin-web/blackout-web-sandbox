const PREFIX = "blackout:";

/** Keys stored without the blackout: prefix — cleared on Clerk sign-out. */
const EXTRA_SIGN_OUT_KEYS = ["largo-terminal-session", "blackout_desk_v1"] as const;

export const LARGO_SESSION_KEY = "largo-terminal-session";

type CacheEnvelope<T> = {
  at: number;
  sessionDate?: string;
  data: T;
};

export function todayEtYmdClient(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/** Scope sessionStorage keys by ET session date so post-close reloads do not show prior session. */
export function sessionScopedCacheKey(key: string, sessionDate = todayEtYmdClient()): string {
  return `${key}:${sessionDate}`;
}

export function readSessionCache<T>(key: string, maxAgeMs?: number): T | undefined {
  if (typeof window === "undefined") return undefined;
  const today = todayEtYmdClient();
  const scopedKey = sessionScopedCacheKey(key, today);
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${scopedKey}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.sessionDate && parsed.sessionDate !== today) return undefined;
    if (maxAgeMs != null && Date.now() - parsed.at > maxAgeMs) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function writeSessionCache<T>(key: string, data: T, sessionDate = todayEtYmdClient()): void {
  if (typeof window === "undefined") return;
  try {
    const scopedKey = sessionScopedCacheKey(key, sessionDate);
    const envelope: CacheEnvelope<T> = { at: Date.now(), sessionDate, data };
    sessionStorage.setItem(`${PREFIX}${scopedKey}`, JSON.stringify(envelope));
  } catch {
    // ignore quota / private mode
  }
}

export function clearSessionCacheKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = `${PREFIX}${key}`;
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Clear all blackout session keys — call on Clerk sign-out. */
export function clearAllSessionCache(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
    for (const k of EXTRA_SIGN_OUT_KEYS) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
