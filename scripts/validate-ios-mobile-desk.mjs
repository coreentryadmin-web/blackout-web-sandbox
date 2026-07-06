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
  ["--viewport-chrome", "viewport chrome token"],
  ["--ios-tab-offset", "iOS bottom tab bar offset token"],
  [".ios-app-tab-bar", "iOS bottom tab bar component styles"],
  ["html.ios-app.ios-tab-bar .nav-sheet-toggle", "hide hamburger when tab bar visible"],
  ["overflow-x: hidden", "WKWebView horizontal overflow guard"],
  ["html.nav-locked .nav-brand", "drawer-open nav wordmark hide"],
  ["html.ios-app .nav-auth .nav-push-slot", "hide push toggle from cramped top bar"],
  [".spx-hero-price", "mobile hero price scale hook"],
  ["grid-template-columns: repeat(2, minmax(0, 1fr))", "mobile metric block grid"],
  [".flow-scroll-max", "HELIX tape height clears nav + tab bar"],
  [".ios-tool-locked-screen", "ComingSoon nav clearance"],
  [".auth-mobile-pane", "sign-in safe-area padding"],
  [".ios-account-page", "account page nav offset"],
  ["html.ios-app.ios-tab-bar .ios-desk-shell", "single bottom inset owner for desk"],
];

const sourceNeedles = [
  ["src/components/IosAppTabBar.tsx", "IosAppTabBar"],
  ["src/lib/ios-tool-routes.ts", "ios-tool-routes"],
];
for (const [file, label] of sourceNeedles) {
  try {
    readFileSync(join(root, file), "utf8");
    ok(`file:${label}`, file);
  } catch {
    fail(`file:${label}`, `missing ${file}`);
  }
}
for (const [needle, label] of cssNeedles) {
  if (css.includes(needle)) ok(`css:${label}`, needle);
  else fail(`css:${label}`, `missing ${needle}`);
}

if (header.includes("showValues") && header.includes("hasQuote")) {
  ok("header:closed-session snapshot", "showValues when desk has quote");
} else {
  fail("header:closed-session snapshot", "expected hasQuote + showValues");
}

const nav = readFileSync(join(root, "src/components/Nav.tsx"), "utf8");
if (nav.includes("brandHref") && nav.includes('iosApp && isSignedIn ? "/dashboard"')) {
  ok("nav:ios-brand-dashboard");
} else {
  fail("nav:ios-brand-dashboard", "signed-in iOS brand should link to /dashboard");
}

if (!header.includes('"— — —"')) {
  ok("header:no-triple-dash placeholder");
} else {
  fail("header:no-triple-dash placeholder", 'still renders "— — —"');
}

const dashboard = readFileSync(join(root, "src/app/(site)/dashboard/page.tsx"), "utf8");
if (!dashboard.includes('<main id="main">')) {
  ok("dashboard:no-nested-main");
} else {
  fail("dashboard:no-nested-main", "duplicate id=main breaks skip link");
}

const flowStream = readFileSync(join(root, "src/components/desk/FlowAlertStream.tsx"), "utf8");
if (flowStream.includes("flow-scroll-max") && !flowStream.includes("100vh - 210px")) {
  ok("helix:flow-tape-viewport");
} else {
  fail("helix:flow-tape-viewport", "expected flow-scroll-max without hardcoded 100vh");
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
