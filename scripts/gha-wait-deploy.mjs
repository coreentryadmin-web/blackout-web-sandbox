#!/usr/bin/env node
/** Wait for ECS deploy to settle after a main push, then verify /api/health. */
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const initialWaitMs = Number(process.env.DEPLOY_WAIT_MS ?? 90_000);
const maxAttempts = Number(process.env.DEPLOY_WAIT_ATTEMPTS ?? 12);
const intervalMs = Number(process.env.DEPLOY_WAIT_INTERVAL_MS ?? 20_000);

async function healthOk() {
  const res = await fetch(`${BASE}/api/health`, { headers: { Accept: "application/json" } });
  if (res.status !== 200) return false;
  const body = await res.json().catch(() => ({}));
  return body.ok === true;
}

console.log(`Waiting ${initialWaitMs / 1000}s for ECS deploy to start…`);
await new Promise((r) => setTimeout(r, initialWaitMs));

for (let i = 1; i <= maxAttempts; i++) {
  if (await healthOk()) {
    console.log(`✓ ${BASE}/api/health ok (attempt ${i}/${maxAttempts})`);
    process.exit(0);
  }
  console.log(`  attempt ${i}/${maxAttempts} — not ready, retry in ${intervalMs / 1000}s`);
  await new Promise((r) => setTimeout(r, intervalMs));
}

console.error(`✗ ${BASE} did not become healthy after push`);
process.exit(1);
