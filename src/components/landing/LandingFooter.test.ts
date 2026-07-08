import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Regression: the classic Grid page was fully removed (commit 40099f0, "feat: remove
// classic Grid page and infrastructure (#648)") — src/app/(site)/grid/page.tsx no longer
// exists — but LandingFooter.tsx's INSTRUMENTS list still linked to "/grid". That footer is
// mounted on the homepage, /pricing, and /faq (via FaqPageShell), so every logged-out
// visitor/prospect who clicked "BlackOut Grid" landed on Next's generic not-found page.
// Nav.tsx's FEATURE_LINKS was updated correctly when Grid was removed; only this second,
// duplicate link list was missed. This test statically checks every href in the footer's
// INSTRUMENTS/PLATFORM/SUPPORT link arrays resolves to a real route on disk, so a future
// route removal can't silently leave a dead link in the marketing footer again.

const FOOTER_PATHS = [
  join(__dirname, "LandingFooter.tsx"),
  join(__dirname, "StaticLandingFooter.tsx"),
];
const APP_DIR = join(__dirname, "..", "..", "app");
const SITE_APP_DIR = join(APP_DIR, "(site)");
const MARKETING_APP_DIR = join(APP_DIR, "(marketing)");

// Clerk's sign-in/sign-up live directly under src/app/ (outside the (site) route group)
// as catch-all segments, e.g. src/app/sign-in/[[...sign-in]]/page.tsx.
function hasCatchAllRoute(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && entry.name.startsWith("[[...") && existsSync(join(dir, entry.name, "page.tsx"))
  );
}

function extractHrefs(source: string, arrayName: string): string[] {
  const arrayMatch = source.match(new RegExp(`const ${arrayName} = \\[([\\s\\S]*?)\\n\\];`));
  assert.ok(arrayMatch, `expected to find a "${arrayName}" array literal in footer source`);
  const body = arrayMatch[1];
  return [...body.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
}

function routeExists(href: string): boolean {
  // Strip query/hash and leading slash; ignore external/mailto/anchor-only links.
  const path = href.split(/[?#]/)[0].replace(/^\//, "");
  if (path === "") {
    return existsSync(join(MARKETING_APP_DIR, "page.tsx")) || existsSync(join(SITE_APP_DIR, "page.tsx"));
  }
  if (existsSync(join(SITE_APP_DIR, path, "page.tsx"))) return true;
  if (existsSync(join(MARKETING_APP_DIR, path, "page.tsx"))) return true;
  // Fall back to a top-level src/app/<path>/ route (e.g. Clerk's sign-in/sign-up).
  return hasCatchAllRoute(join(APP_DIR, path)) || existsSync(join(APP_DIR, path, "page.tsx"));
}

test("LandingFooter: INSTRUMENTS links all resolve to real routes", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    const hrefs = extractHrefs(source, "INSTRUMENTS");
    assert.ok(hrefs.length > 0, `expected INSTRUMENTS in ${footerPath}`);
    for (const href of hrefs) {
      assert.ok(routeExists(href), `${footerPath} INSTRUMENTS href "${href}" has no page.tsx`);
    }
  }
});

test("LandingFooter: never links to the removed /grid route", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    assert.doesNotMatch(source, /href:\s*"\/grid"/, `${footerPath} must not link to /grid`);
  }
});

test("LandingFooter: PLATFORM links all resolve to real routes", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    const hrefs = extractHrefs(source, "PLATFORM");
    assert.ok(hrefs.length > 0, `expected PLATFORM in ${footerPath}`);
    for (const href of hrefs) {
      assert.ok(routeExists(href), `${footerPath} PLATFORM href "${href}" has no page.tsx`);
    }
  }
});
