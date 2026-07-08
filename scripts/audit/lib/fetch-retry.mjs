/**
 * Resilient fetch for external staging/prod probes — retries transient TLS resets and 5xx.
 */
const RETRYABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

export function isRetryableFetchError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const code = err.cause?.code ?? err.code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  const msg = String(err.message ?? err);
  return /fetch failed|network|socket hang up|timed out|connection reset/i.test(msg);
}

export function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ retries?: number, baseDelayMs?: number, timeoutMs?: number }} [opts]
 */
export async function fetchRetry(url, init = {}, opts = {}) {
  const retries = opts.retries ?? Number(process.env.FETCH_RETRIES ?? 4) || 4;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (attempt < retries && isRetryableStatus(res.status)) {
        await sleep(baseDelayMs * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryableFetchError(err)) {
        await sleep(baseDelayMs * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("fetchRetry exhausted");
}
