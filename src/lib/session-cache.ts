const PREFIX = "blackout:";

type CacheEnvelope<T> = {
  at: number;
  data: T;
};

export function readSessionCache<T>(key: string, maxAgeMs?: number): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (maxAgeMs != null && Date.now() - parsed.at > maxAgeMs) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function writeSessionCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: CacheEnvelope<T> = { at: Date.now(), data };
    sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(envelope));
  } catch {
    // ignore quota / private mode
  }
}
