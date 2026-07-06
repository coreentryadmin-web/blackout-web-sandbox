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
  ["html.ios-app .page-tool-header", "iOS compact page headers"],
  [".ios-app-tab-active-bar", "tab bar active glow indicator"],
  ["html.ios-app .nav-bar-ios-tool", "iOS tool context nav mode"],
  ["@keyframes ios-page-enter", "iOS page enter animation"],
  ["html.ios-app .flow-seg-btn", "iOS touch-sized segment buttons"],
  ["html.ios-app.ios-tab-bar .ios-desk-shell", "single bottom inset owner for desk"],
];

const nativeCss = readFileSync(join(root, "src/app/ios-native.css"), "utf8");
const nativeNeedles = [
  ["html.ios-app.ios-native-shell", "native shell scope"],
  ["--ios-header-offset", "native header offset token"],
  ["html.ios-app.ios-native-shell .nav-bar", "hide web nav in native shell"],
  [".ios-native-header", "native top bar"],
  [".ios-native-menu-sheet", "native bottom sheet menu"],
  ["html.ios-app.ios-native-shell .spx-sniper-identity", "hide duplicate SPX title"],
  ["html.ios-app.ios-native-shell.ios-tab-bar .page-tool-header", "hide duplicate page headers"],
  ["html.ios-app.ios-native-shell .ios-app-tab-bar", "floating dock tab bar"],
];
const pagesCss = readFileSync(join(root, "src/app/ios-native-pages.css"), "utf8");
const pagesNeedles = [
  [".ios-native-segment", "native segment control"],
  [".ios-native-panel-hidden", "panel switcher utility"],
  ['data-ios-route="dashboard"', "SPX native page scope"],
  ['data-ios-route="flows"', "HELIX native page scope"],
  ['data-ios-route="largo"', "Largo native page scope"],
  [".thermal-page-inner-native", "Thermal native page padding hook"],
  [".gex-matrix-scroll", "Thermal matrix scroll region hook"],
  [".gex-key-levels", "Thermal key levels hook"],
  [".spx-sniper-command-native", "SPX compact native hero hook"],
  [".helix-page-inner-native", "HELIX native page hook"],
  [".grid-page-inner-native", "Grid native page hook"],
  [".nighthawk-page-inner-native", "Night Hawk native page hook"],
  [".largo-page-main-native", "Largo full-bleed main hook"],
  [".largo-terminal-native", "Largo edge-to-edge terminal hook"],
  [".account-page-title-block", "account title hide hook"],
  [".helix-ios-toolbar", "HELIX sticky filter bar"],
  [".grid-page-tabs", "grid page tabs hook"],
  ['data-ios-route="faq"', "FAQ native page scope"],
  ['data-ios-route="learn"', "Learn native page scope"],
  [".faq-native-view", "FAQ native accordion layout"],
  [".learn-page-shell-native", "Learn native page shell hook"],
  [".gex-ticker-native-sheet", "Thermal native ticker bottom sheet"],
];
for (const [needle, label] of pagesNeedles) {
  if (pagesCss.includes(needle)) ok(`pages-css:${label}`, needle);
  else fail(`pages-css:${label}`, `missing ${needle}`);
}
for (const [needle, label] of nativeNeedles) {
  if (nativeCss.includes(needle)) ok(`native-css:${label}`, needle);
  else fail(`native-css:${label}`, `missing ${needle}`);
}

const sourceNeedles = [
  ["src/components/IosAppTabBar.tsx", "IosAppTabBar"],
  ["src/components/ios/IosAppChrome.tsx", "IosAppChrome"],
  ["src/components/ios/IosNativePageTransition.tsx", "IosNativePageTransition"],
  ["src/lib/ios-tool-routes.ts", "ios-tool-routes"],
];
const navCss = readFileSync(join(root, "src/app/ios-native-nav.css"), "utf8");
const motionCss = readFileSync(join(root, "src/app/ios-native-motion.css"), "utf8");
const skinCss = readFileSync(join(root, "src/app/ios-native-skin.css"), "utf8");
const navNeedles = [
  [".ios-native-page-stage", "page transition stage"],
  [".ios-app-tab-indicator", "sliding tab indicator"],
  [".ios-native-segment-indicator", "sliding segment indicator"],
  ["ios-panel-enter", "internal panel crossfade"],
  ["animation: none !important", "disable legacy page enter"],
];
for (const [needle, label] of navNeedles) {
  if (navCss.includes(needle)) ok(`nav-css:${label}`, needle);
  else fail(`nav-css:${label}`, `missing ${needle}`);
}

const motionNeedles = [
  ["ios-content-rise", "content enter animation"],
  ["ios-module-enter", "module enter animation"],
  ["ios-scan-pulse", "ambient scan pulse"],
  ["ios-hero-tick", "SPX hero tick glow"],
];
for (const [needle, label] of motionNeedles) {
  if (motionCss.includes(needle)) ok(`motion-css:${label}`, needle);
  else fail(`motion-css:${label}`, `missing ${needle}`);
}

const commandCss = readFileSync(join(root, "src/app/ios-native-command.css"), "utf8");
const commandNeedles = [
  ["--cmd-panel", "command panel token"],
  ["--cmd-radius-panel", "sharp panel radius"],
  [".ios-app-tab-label", "instrument rail full labels"],
  [".ios-native-header-kicker", "command bar kicker"],
  [".helix-native-watchlist", "HELIX watchlist strip"],
  ["ios-app-pending-shell", "anti-flash pending shell"],
  ["border-left: 2px solid var(--ios-accent)", "accent rail on data modules"],
];
for (const [needle, label] of commandNeedles) {
  if (commandCss.includes(needle)) ok(`command-css:${label}`, needle);
  else fail(`command-css:${label}`, `missing ${needle}`);
}

const menu = readFileSync(join(root, "src/components/ios/IosNativeMenu.tsx"), "utf8");
if (menu.includes("CMD · INSTRUMENT SELECT")) ok("command:deck-menu-label");
else fail("command:deck-menu-label", "expected command deck kicker in IosNativeMenu");

const skinNeedles = [
  [".ios-native-ambient", "route ambient glow"],
  ["--ios-accent:", "route accent token"],
  ["--ios-surface-1", "glass surface token"],
  ["--ios-shadow-card", "card shadow token"],
  ["--ios-touch:", "touch target token"],
  ["--ios-input:", "16px input token prevents iOS focus zoom"],
  [".flow-seg-btn-active-all", "segment active skin"],
  [".largo-suggestion-chip", "Largo chip skin"],
  [".nighthawk-play-row", "Night Hawk card skin"],
  [".ios-tool-locked-screen", "locked tool skin"],
  ['data-ios-route="flows"', "HELIX accent route"],
];
for (const [needle, label] of skinNeedles) {
  if (skinCss.includes(needle)) ok(`skin-css:${label}`, needle);
  else fail(`skin-css:${label}`, `missing ${needle}`);
}

const chrome = readFileSync(join(root, "src/components/ios/IosAppChrome.tsx"), "utf8");
if (chrome.includes("ios-native-ambient")) {
  ok("skin:ambient-layer-mounted");
} else {
  fail("skin:ambient-layer-mounted", "expected ios-native-ambient in IosAppChrome");
}

const tabBar = readFileSync(join(root, "src/components/IosAppTabBar.tsx"), "utf8");
if (tabBar.includes("ios-app-tab-label") && tabBar.includes("scroll={false}")) {
  ok("nav:instrument-rail-labels");
} else {
  fail("nav:instrument-rail-labels", "expected full tool labels + scroll={false}");
}

const pageTransition = readFileSync(join(root, "src/components/ios/IosNativePageTransition.tsx"), "utf8");
if (pageTransition.includes("getIosToolRouteIndex") && pageTransition.includes("AnimatePresence")) {
  ok("nav:direction-aware-page-transition");
} else {
  fail("nav:direction-aware-page-transition", "expected route-index transitions");
}
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
if (nav.includes("iosToolLabel") && nav.includes("getIosToolNavLabel")) {
  ok("nav:ios-tool-context-title");
} else {
  fail("nav:ios-tool-context-title", "expected centered tool title on iOS");
}

const siteLayout = readFileSync(join(root, "src/app/(site)/layout.tsx"), "utf8");
const spxDash = readFileSync(join(root, "src/components/SpxDashboard.tsx"), "utf8");
if (spxDash.includes("IosNativeSegment") && spxDash.includes("iosPanel")) {
  ok("spx:ios-panel-switcher");
} else {
  fail("spx:ios-panel-switcher", "expected IosNativeSegment panel switcher");
}

const flowFeed = readFileSync(join(root, "src/components/FlowFeed.tsx"), "utf8");
if (flowFeed.includes("iosView") && flowFeed.includes("helix-ios-toolbar")) {
  ok("helix:ios-view-switcher");
} else {
  fail("helix:ios-view-switcher", "expected tape/analytics switcher");
}

const nhFeed = readFileSync(join(root, "src/components/NightHawkFeed.tsx"), "utf8");
if (nhFeed.includes("iosView") && nhFeed.includes("playbook")) {
  ok("nighthawk:ios-view-switcher");
} else {
  fail("nighthawk:ios-view-switcher", "expected playbook/watch switcher");
}

const largoShell = readFileSync(join(root, "src/components/desk/LargoPageShell.tsx"), "utf8");
if (largoShell.includes("useIosNativeShell") && largoShell.includes("!nativeShell")) {
  ok("largo:page-shell-native-gate");
} else {
  fail("largo:page-shell-native-gate", "expected LargoPageShell to hide web header on native");
}

const thermalShell = readFileSync(join(root, "src/components/desk/ThermalPageShell.tsx"), "utf8");
const helixShell = readFileSync(join(root, "src/components/desk/HelixPageShell.tsx"), "utf8");
const gridShell = readFileSync(join(root, "src/components/desk/GridPageShell.tsx"), "utf8");
const nhShell = readFileSync(join(root, "src/components/desk/NighthawkPageShell.tsx"), "utf8");
if (thermalShell.includes("useIosNativeShell") && thermalShell.includes("!nativeShell")) {
  ok("thermal:page-shell-native-gate");
} else {
  fail("thermal:page-shell-native-gate", "expected ThermalPageShell to hide web header on native");
}
for (const [file, label] of [
  ["HelixPageShell", helixShell],
  ["GridPageShell", gridShell],
  ["NighthawkPageShell", nhShell],
]) {
  const slug = file.replace("PageShell", "").toLowerCase();
  if (label.includes("useIosNativeShell") && label.includes("!nativeShell")) {
    ok(`${slug}:page-shell-native-gate`);
  } else {
    fail(`${slug}:page-shell-native-gate`, `expected ${file} to hide web header on native`);
  }
}

const flowsPage = readFileSync(join(root, "src/app/(site)/flows/page.tsx"), "utf8");
const gridPage = readFileSync(join(root, "src/app/(site)/grid/page.tsx"), "utf8");
const nhPage = readFileSync(join(root, "src/app/(site)/nighthawk/page.tsx"), "utf8");
if (flowsPage.includes("HelixPageShell")) ok("flows:uses-helix-page-shell");
else fail("flows:uses-helix-page-shell", "expected HelixPageShell");
if (gridPage.includes("GridPageShell")) ok("grid:uses-grid-page-shell");
else fail("grid:uses-grid-page-shell", "expected GridPageShell");
if (nhPage.includes("NighthawkPageShell")) ok("nighthawk:uses-nighthawk-page-shell");
else fail("nighthawk:uses-nighthawk-page-shell", "expected NighthawkPageShell");

const faqPage = readFileSync(join(root, "src/app/(site)/faq/page.tsx"), "utf8");
const learnLayout = readFileSync(join(root, "src/app/(site)/learn/layout.tsx"), "utf8");
if (faqPage.includes("FaqPageShell")) ok("faq:uses-faq-page-shell");
else fail("faq:uses-faq-page-shell", "expected FaqPageShell");
if (learnLayout.includes("LearnPageShell")) ok("learn:uses-learn-page-shell");
else fail("learn:uses-learn-page-shell", "expected LearnPageShell");

const faqNative = readFileSync(join(root, "src/components/faq/FaqNativeView.tsx"), "utf8");
if (faqNative.includes("faq-native-view") && faqNative.includes("faq-native-cat-chip")) {
  ok("faq:native-accordion-view");
} else {
  fail("faq:native-accordion-view", "expected FaqNativeView accordion layout");
}

const faqSection = readFileSync(join(root, "src/components/landing/FaqSection.tsx"), "utf8");
if (faqSection.includes("FaqNativeView") && faqSection.includes("useIosNativeShell")) {
  ok("faq:native-shell-gate");
} else {
  fail("faq:native-shell-gate", "expected FaqSection to gate native view");
}

const learnHub = readFileSync(join(root, "src/components/learn/LearnHub.tsx"), "utf8");
if (learnHub.includes("useIosNativeShell") && learnHub.includes("learn-hub-native")) {
  ok("learn:hub-native-gate");
} else {
  fail("learn:hub-native-gate", "expected LearnHub compact native mode");
}

const gexHeatmap = readFileSync(join(root, "src/components/desk/GexHeatmap.tsx"), "utf8");
if (gexHeatmap.includes("nativeShell={nativeShell}") && gexHeatmap.includes("gex-ticker-native-sheet")) {
  ok("thermal:native-ticker-sheet");
} else {
  fail("thermal:native-ticker-sheet", "expected TickerSwitcher native bottom sheet");
}

const largoTerm = readFileSync(join(root, "src/components/desk/LargoTerminal.tsx"), "utf8");
if (largoTerm.includes("useIosKeyboardInset")) {
  ok("largo:keyboard-inset-hook");
} else {
  fail("largo:keyboard-inset-hook", "expected useIosKeyboardInset in LargoTerminal");
}

const largoPage = readFileSync(join(root, "src/components/desk/LargoPageShell.tsx"), "utf8");
if (largoPage.includes("LargoNativeTerminal")) ok("largo:native-terminal-component");
else fail("largo:native-terminal-component", "expected LargoNativeTerminal in LargoPageShell");

const largoNative = readFileSync(join(root, "src/components/desk/LargoNativeTerminal.tsx"), "utf8");
if (largoNative.includes("largo-native-desk") && largoNative.includes("useLargoChat")) {
  ok("largo:mobile-only-desk");
} else {
  fail("largo:mobile-only-desk", "expected dedicated LargoNativeTerminal");
}

const viewportLock = readFileSync(join(root, "src/components/ios/IosViewportLock.tsx"), "utf8");
if (viewportLock.includes("maximum-scale=1")) ok("ios:viewport-zoom-lock");
else fail("ios:viewport-zoom-lock", "expected IosViewportLock");

const inputLockCss = readFileSync(join(root, "src/app/ios-native-input-lock.css"), "utf8");
if (inputLockCss.includes("font-size: 16px !important")) ok("ios:input-16px-lock");
else fail("ios:input-16px-lock", "expected 16px input lock CSS");

const rootLayout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
if (rootLayout.includes("IosViewportLock") && rootLayout.includes("ios-native-input-lock.css")) {
  ok("layout:ios-viewport-lock-mounted");
} else {
  fail("layout:ios-viewport-lock-mounted", "expected IosViewportLock + input-lock CSS");
}
if (rootLayout.includes("ios-native-motion.css")) ok("layout:ios-native-motion-imported");
else fail("layout:ios-native-motion-imported", "expected ios-native-motion.css import");
if (rootLayout.includes("ios-native-command.css")) ok("layout:ios-native-command-imported");
else fail("layout:ios-native-command-imported", "expected ios-native-command.css import");
if (rootLayout.includes("ios-native-viewport.css")) ok("layout:ios-native-viewport-imported");
else fail("layout:ios-native-viewport-imported", "expected ios-native-viewport.css import");

const viewportCss = readFileSync(join(root, "src/app/ios-native-viewport.css"), "utf8");
const viewportNeedles = [
  ["--ios-viewport-h", "viewport height token"],
  ["padding-bottom: 0 !important", "single bottom inset owner"],
  ["spx-sniper-desk", "SPX desk flex fill"],
  ["spx-desk-closed", "market closed fills panel"],
  ["overflow-x: auto", "scrollable instrument rail"],
];
for (const [needle, label] of viewportNeedles) {
  if (viewportCss.includes(needle)) ok(`viewport-css:${label}`, needle);
  else fail(`viewport-css:${label}`, `missing ${needle}`);
}

if (rootLayout.includes("ios-native-iphone16.css")) ok("layout:ios-native-iphone16-imported");
else fail("layout:ios-native-iphone16-imported", "expected ios-native-iphone16.css import");
if (rootLayout.includes("ios-tier-pro-max")) ok("layout:iphone16-tier-detection");
else fail("layout:iphone16-tier-detection", "expected ios-tier-pro in head script");

const iphone16Css = readFileSync(join(root, "src/app/ios-native-iphone16.css"), "utf8");
const iphone16Needles = [
  ["ios-tier-pro", "Pro tier hook"],
  ["ios-tier-pro-max", "Pro Max tier hook"],
  ["min-width: 393px", "iPhone 16 Pro breakpoint"],
  ["min-width: 430px", "iPhone 16 Pro Max breakpoint"],
  ["grid-template-columns: repeat(3", "Pro Max 3-col metrics"],
];
for (const [needle, label] of iphone16Needles) {
  if (iphone16Css.includes(needle)) ok(`iphone16-css:${label}`, needle);
  else fail(`iphone16-css:${label}`, `missing ${needle}`);
}

const spxHeader = readFileSync(join(root, "src/components/desk/SpxSniperHeader.tsx"), "utf8");
if (spxHeader.includes("nativeShell") && spxHeader.includes("spx-sniper-command-native")) {
  ok("spx:compact-native-header");
} else {
  fail("spx:compact-native-header", "expected nativeShell compact SPX hero");
}

const iosE2e = readFileSync(join(root, "scripts/ios-native-ui-e2e.mjs"), "utf8");
if (iosE2e.includes("mintIosPlaywrightSession") && iosE2e.includes("testToolPage")) {
  ok("ios:playwright-e2e-script");
} else {
  fail("ios:playwright-e2e-script", "expected ios-native-ui-e2e.mjs");
}

if (siteLayout.includes("IosAppChrome")) {
  ok("layout:IosAppChrome-mounted");
} else {
  fail("layout:IosAppChrome-mounted", "expected IosAppChrome in site layout");
}

const toolRoutes = readFileSync(join(root, "src/lib/ios-tool-routes.ts"), "utf8");
if (
  toolRoutes.includes("isIosNativeShellRoute") &&
  toolRoutes.includes("IOS_TOOLS") &&
  toolRoutes.includes("getIosRouteKey") &&
  toolRoutes.includes("getIosHeaderMeta")
) {
  ok("routes:native-shell-metadata");
} else {
  fail("routes:native-shell-metadata", "expected IOS_TOOLS + route helpers");
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
