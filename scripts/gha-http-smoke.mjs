#!/usr/bin/env node
/** Minimal prod HTTP smoke for GitHub Actions (no secrets except optional CRON). */
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET?.trim() ?? "";

const publicChecks = [
  { path: "/api/health", expect: 200, test: (b) => b.ok === true },
  { path: "/api/ready", expect: 200, test: (b) => b.ok === true },
  { path: "/api/market/regime", expect: 200, test: (b) => b.available === true },
  { path: "/api/public/track-record", expect: 200, test: (b) => b.available === true },
  { path: "/api/signals/open", expect: 401 },
  { path: "/api/admin/debug-uw", expect: 401 },
  { path: "/api/engine/health", expect: 401 },
  { path: "/", expect: 200 },
  { path: "/track-record", expect: 200 },
];

const failures = [];

async function fetchJson(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 120);
  }
  return { status: res.status, body };
}

function trackRecordConsistent(page, pub) {
  if (!pub.available) return page.spxSlayer?.total === 0;
  return (
    page.spxSlayer?.total === pub.total_closed &&
    page.spxSlayer?.wins === pub.wins &&
    page.spxSlayer?.losses === pub.losses
  );
}

for (const c of publicChecks) {
  const { status, body } = await fetchJson(c.path);
  const pass = status === c.expect && (c.test ? c.test(body) : true);
  if (pass) console.log(`  ✓ ${c.path} → ${status}`);
  else {
    failures.push(`${c.path} → ${status}`);
    console.log(`  ✗ ${c.path} → ${status}`);
  }
}

// Split-brain guard: /api/track-record SPX block must match public ledger (#47)
const [{ body: pageTr }, { body: pubTr }] = await Promise.all([
  fetchJson("/api/track-record"),
  fetchJson("/api/public/track-record"),
]);
if (pageTr?.spxSlayer && pubTr?.available !== undefined) {
  if (trackRecordConsistent(pageTr, pubTr)) {
    console.log(
      `  ✓ track-record ledger match → page ${pageTr.spxSlayer.total} closed = public ${pubTr.total_closed ?? 0}`
    );
  } else {
    failures.push(
      `track-record split-brain: page ${pageTr.spxSlayer.wins}/${pageTr.spxSlayer.losses}/${pageTr.spxSlayer.total} vs public ${pubTr.wins}/${pubTr.losses}/${pubTr.total_closed}`
    );
    console.log(
      `  ✗ track-record split-brain → page ${pageTr.spxSlayer.wins}/${pageTr.spxSlayer.losses}/${pageTr.spxSlayer.total} vs public ${pubTr.wins}/${pubTr.losses}/${pubTr.total_closed}`
    );
  }
} else {
  failures.push("track-record consistency check: missing payload fields");
  console.log("  ✗ track-record consistency check → missing payload fields");
}

if (CRON) {
  const { status, body } = await fetchJson("/api/market/spx/desk", {
    Authorization: `Bearer ${CRON}`,
  });
  if (status === 200 && body?.price > 0) console.log(`  ✓ /api/market/spx/desk → SPX ${body.price}`);
  else {
    failures.push(`spx/desk → ${status}`);
    console.log(`  ✗ /api/market/spx/desk → ${status}`);
  }
}

if (failures.length) {
  console.error(`\nHTTP smoke FAILED (${failures.length})`);
  process.exit(1);
}
