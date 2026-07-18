// Cron trigger for ECS scheduled tasks.
// Calls a /api/cron/* endpoint on the deployed web app with the Bearer secret,
// then exits — exactly the run-to-completion behavior a cron service needs.
//
// Usage:  node scripts/hit-cron.mjs /api/cron/db-cleanup
// Env:    CRON_SECRET            (required) — same value as on blackout-web
//         CRON_TARGET_BASE_URL   (optional) — defaults to https://blackouttrades.com
//         CRON_HTTP_TIMEOUT_MS   (optional) — request timeout, defaults to 60000 (60s)
//         CRON_HIT_RETRIES       (optional) — retry count on transient failure, default 4
//         CRON_HIT_RETRY_DELAY_MS (optional) — base backoff ms between retries, default 3000
//
// Uses only Node stdlib + global fetch (Node 18+), so the cron service does NOT
// need the Next.js app build or node_modules.

const path = process.argv[2];
if (!path) {
  console.error("[hit-cron] usage: node scripts/hit-cron.mjs <endpoint-path>");
  process.exit(1);
}

const base = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("[hit-cron] CRON_SECRET is not set on this service");
  process.exit(1);
}

const url = `${base}${path}`;
const timeoutMs = Number(process.env.CRON_HTTP_TIMEOUT_MS ?? 60_000) || 60_000;
const maxRetries = Math.max(0, Number(process.env.CRON_HIT_RETRIES ?? 4) || 4);
const baseDelayMs = Math.max(500, Number(process.env.CRON_HIT_RETRY_DELAY_MS ?? 3000) || 3000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const code = err.cause?.code ?? err.code;
  if (code && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
    return true;
  }
  const msg = String(err.message ?? err);
  return /fetch failed|network|socket hang up|timed out/i.test(msg);
}

async function attemptOnce() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    const body = await res.text();
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

let lastBody = "";
let lastStatus = 0;

for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    const { res, body } = await attemptOnce();
    lastBody = body;
    lastStatus = res.status;
    console.log(`[hit-cron] ${path} -> ${res.status}${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}`);
    console.log(body.slice(0, 2000));

    if (res.ok) {
      process.exit(0);
    }

    if (attempt < maxRetries && isRetryableStatus(res.status)) {
      const delay = baseDelayMs * (attempt + 1);
      console.warn(`[hit-cron] ${path} HTTP ${res.status} — retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }

    process.exit(1);
  } catch (err) {
    const detail = err?.name === "AbortError"
      ? `request timed out after ${timeoutMs}ms`
      : String(err?.message ?? err);
    console.error(`[hit-cron] ${path} request failed${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}: ${detail}`);

    if (attempt < maxRetries && isRetryableError(err)) {
      const delay = baseDelayMs * (attempt + 1);
      console.warn(`[hit-cron] ${path} transient error — retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }

    process.exit(1);
  }
}

console.error(`[hit-cron] ${path} failed after ${maxRetries + 1} attempt(s); last status ${lastStatus}`);
if (lastBody) console.log(lastBody.slice(0, 2000));
process.exit(1);
