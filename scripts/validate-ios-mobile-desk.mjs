#!/usr/bin/env node
/**
 * Static + prod smoke checks for iOS / narrow-viewport SPX Slayer desk fixes.
 * Does not replace TestFlight on a physical device — validates deployable artifacts
 * and authenticated desk API shape from this environment.
 *
 * Usage: npm run validate:ios-mobile-desk
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mintClerkPremiumSession } from "./audit/lib/prod-clerk-session.mjs";

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const header = readFileSync(join(root, "src/components/desk/SpxSniperHeader.tsx"), "utf8");

const checks = [];
const ok = (name, detail = "") => {
  checks.push({ name, pass: true, detail });
  console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name, detail = "") => {
  checks.push({ name, pass: false, detail });
  console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("validate:ios-mobile-desk — static CSS/component guards\n");

const cssNeedles = [
  ["html.ios-app {", "iOS safe-area nav offset"],
  ["overflow-x: hidden", "WKWebView horizontal overflow guard"],
  ["html.nav-locked .nav-brand", "drawer-open nav wordmark hide"],
  [".spx-hero-price", "mobile hero price scale hook"],
  ["grid-template-columns: repeat(2, minmax(0, 1fr))", "mobile metric block grid"],
];
for (const [needle, label] of cssNeedles) {
  if (css.includes(needle)) ok(`css:${label}`, needle);
  else fail(`css:${label}`, `missing ${needle}`);
}

if (header.includes("showValues") && header.includes("hasQuote")) {
  ok("header:closed-session snapshot", "showValues when desk has quote");
} else {
  fail("header:closed-session snapshot", "expected hasQuote + showValues");
}

if (!header.includes('"— — —"')) {
  ok("header:no-triple-dash placeholder");
} else {
  fail("header:no-triple-dash placeholder", 'still renders "— — —"');
}

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");

async function prodDeskSmoke() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`\n  [SKIP] prod desk API — ${session.reason}`);
    return;
  }

  console.log("\nvalidate:ios-mobile-desk — prod desk API smoke\n");

  try {
    const deskRes = await fetch(`${BASE}/api/market/spx/desk`, {
      headers: { Cookie: session.cookieHeader },
    });
    if (deskRes.status !== 200) {
      fail("api:spx/desk", `HTTP ${deskRes.status}`);
      return;
    }
    const desk = await deskRes.json();
    ok("api:spx/desk", `available=${desk.available} price=${desk.price ?? 0}`);

    if (desk.available && desk.price > 0) {
      ok("api:desk-has-quote", String(desk.price));
    } else {
      console.log("  [WARN] api:desk-has-quote — empty off-hours (UI will show honest empty state)");
    }
  } finally {
    await session.cleanup();
  }
}

await prodDeskSmoke();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
