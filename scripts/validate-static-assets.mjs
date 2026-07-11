#!/usr/bin/env node
/**
 * Post-deploy guard — every referenced /_next/static/* asset must return 200.
 * Cloudflare can edge-cache 404s on hashed static paths during deploy skew;
 * this catches HTML/JS/CSS hash mismatches before users see a broken site.
 *
 * Usage:
 *   node scripts/validate-static-assets.mjs
 *   BASE_URL=https://staging.blackouttrades.com node scripts/validate-static-assets.mjs
 */

const BASE = (process.env.BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const PAGES = ["/", "/sign-in", "/sign-up"];

const ASSET_RE = /\/_next\/static\/[^"']+\.(?:css|js|woff2)/g;

async function fetchText(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function headStatus(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: "HEAD",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  return res.status;
}

const failures = [];
const checked = new Set();

for (const page of PAGES) {
  const { status, text } = await fetchText(page);
  if (status !== 200) {
    failures.push(`${page} → HTTP ${status}`);
    continue;
  }
  const assets = [...text.matchAll(ASSET_RE)].map((m) => m[0]);
  for (const asset of [...new Set(assets)]) {
    if (checked.has(asset)) continue;
    checked.add(asset);
    const code = await headStatus(asset);
    if (code !== 200) failures.push(`${asset} → HTTP ${code} (from ${page})`);
  }
}

console.log(`Checked ${checked.size} static assets across ${PAGES.length} pages (${BASE})`);

if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log("  ✓ All static assets return 200");
process.exit(0);
