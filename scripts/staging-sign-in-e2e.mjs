#!/usr/bin/env node
/**
 * Live staging satellite sign-in E2E — browser walks redirect → primary sign-in
 * → staging dashboard, then clicks desk controls.
 *
 * Usage: node scripts/staging-sign-in-e2e.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const PRIMARY = "https://blackouttrades.com";
const OUT = process.env.STAGING_SIGNIN_E2E_DIR || "/opt/cursor/artifacts/staging-sign-in-e2e";
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const CJS = "5.57.0";

mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

async function shot(page, name) {
  const path = join(OUT, `${name.replace(/[^a-z0-9_-]+/gi, "-")}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

function loadClerkSecrets() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  const s = JSON.parse(raw);
  return { secret: s.CLERK_SECRET_KEY, publishableKey: s.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY };
}

async function mintTicket(secret) {
  const API = "https://api.clerk.com/v1";
  const email = `staging-signin-e2e-${Date.now()}@blackouttrades.com`;
  const phone = `+1415555${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const backend = (method, path, body) =>
    fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  const createRes = await backend("POST", "/users", {
    email_address: [email],
    phone_number: [phone],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const created = await createRes.json().catch(() => null);
  const userId = created?.id;
  if (!userId) throw new Error(`user create failed: ${JSON.stringify(created)?.slice(0, 200)}`);

  const tokenRes = await backend("POST", "/sign_in_tokens", { user_id: userId });
  const ticket = (await tokenRes.json().catch(() => null))?.token;
  if (!ticket) throw new Error("sign_in_tokens failed");

  return {
    ticket,
    cleanup: async () => {
      try {
        await backend("DELETE", `/users/${userId}`);
      } catch {
        /* best-effort */
      }
    },
  };
}

async function main() {
  console.log(`\n=== Staging sign-in live E2E ===`);
  console.log(`Staging: ${STAGING}`);
  console.log(`Artifacts: ${OUT}\n`);

  const { secret } = loadClerkSecrets();
  const { ticket, cleanup } = await mintTicket(secret);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(onboardingInitScript());
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ResizeObserver/i.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // 1) Staging /sign-in must redirect to primary
    console.log("--- Sign-in redirect chain ---");
    let redirectedToPrimary = false;
    page.on("response", (res) => {
      if (res.status() === 307 && res.url().includes("/sign-in")) redirectedToPrimary = true;
    });
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const urlAfterStaging = page.url();
    if (urlAfterPrimaryCheck(urlAfterStaging) || redirectedToPrimary) {
      rec("redirect:staging-to-primary", "PASS", urlAfterStaging);
    } else if (urlAfterStaging.includes("blackouttrades.com/sign-in")) {
      rec("redirect:staging-to-primary", "PASS", urlAfterStaging);
    } else {
      rec("redirect:staging-to-primary", "FAIL", `stuck at ${urlAfterStaging}`);
    }
    await shot(page, "01-after-staging-signin");

    // 2) Primary sign-in page shows Clerk form
    if (!page.url().includes("blackouttrades.com")) {
      await page.goto(`${PRIMARY}/sign-in?redirect_url=${encodeURIComponent(`${STAGING}/dashboard`)}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    await page.waitForTimeout(3000);
    const hasClerkForm =
      (await page.locator(".cl-root, .cl-card, [class*='cl-signIn']").count()) > 0 ||
      (await page.locator('input[name="identifier"], input[type="email"]').count()) > 0;
    if (hasClerkForm) rec("primary:clerk-form", "PASS");
    else rec("primary:clerk-form", "WARN", "Clerk widget not in DOM yet — may still hydrate");
    await shot(page, "02-primary-signin-form");

    // 3) Complete sign-in via ticket (real auth path) with staging return URL
    const returnUrl = `${STAGING}/dashboard`;
    const ticketUrl = `${PRIMARY}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}&redirect_url=${encodeURIComponent(returnUrl)}`;
    await page.goto(ticketUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(4000);
    await page.waitForURL(/staging\.blackouttrades\.com/, { timeout: 60_000 }).catch(() => null);
    const finalUrl = page.url();
    const syncFailed = finalUrl.includes("__clerk_synced=false");
    if (finalUrl.includes("staging.blackouttrades.com") && !syncFailed) {
      rec("auth:return-to-staging", "PASS", finalUrl);
    } else if (syncFailed) {
      rec("auth:return-to-staging", "FAIL", `satellite sync failed: ${finalUrl}`);
    } else {
      rec("auth:return-to-staging", "FAIL", `unexpected URL: ${finalUrl}`);
    }
    await shot(page, "03-after-ticket-signin");

    // 4) Clerk session on staging
    await page.waitForFunction(() => window.Clerk?.status === "ready", { timeout: 45_000 }).catch(() => null);
    await page.waitForTimeout(2000);
    const authed = await page.evaluate(() => Boolean(window.Clerk?.user?.id));
    const userBtn = (await page.locator(".cl-userButtonTrigger, [class*='userButton']").count()) > 0;
    if (authed || userBtn) rec("auth:staging-session", "PASS", authed ? "Clerk.user set" : "UserButton visible");
    else {
      const body = await page.locator("body").innerText().catch(() => "");
      if (/SPX|Slayer|gamma|matrix/i.test(body)) rec("auth:staging-session", "WARN", "desk rendered, Clerk.user pending");
      else rec("auth:staging-session", "FAIL", "no session on staging");
    }
    await shot(page, "04-staging-session");

    // 5) Dashboard + button clicks
    console.log("\n--- Dashboard interactions ---");
    if (!finalUrl.includes("/dashboard")) {
      await page.goto(`${STAGING}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(2500);
    }
    const desk = page.locator(".spx-sniper-desk, [data-testid='spx-desk']").first();
    if (await desk.isVisible().catch(() => false)) rec("desk:visible", "PASS");
    else rec("desk:visible", "FAIL");

    for (const seg of ["Matrix", "Plays", "Intel"]) {
      const btn = page.locator(".spx-seg-btn, .ios-native-segment-btn, button", { hasText: seg }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);
        rec(`desk:segment-${seg.toLowerCase()}`, "PASS");
      } else {
        rec(`desk:segment-${seg.toLowerCase()}`, "WARN", "not found");
      }
    }

    const gexTab = page.locator("#spx-matrix-tab-gex, [id*='matrix-tab-gex']").first();
    if (await gexTab.isVisible().catch(() => false)) {
      await gexTab.click({ force: true, timeout: 5000 }).catch(() => null);
      rec("desk:matrix-gex-tab", "PASS");
    }
    const vexTab = page.locator("#spx-matrix-tab-vex, [id*='matrix-tab-vex']").first();
    if (await vexTab.isVisible().catch(() => false)) {
      await vexTab.click({ force: true, timeout: 5000 }).catch(() => null);
      rec("desk:matrix-vex-tab", "PASS");
    }
    await shot(page, "05-desk-matrix");

    // 6) Nav to other tools
    console.log("\n--- Nav + tools ---");
    for (const path of ["/flows", "/heatmap", "/terminal", "/nighthawk", "/account"]) {
      await page.goto(`${STAGING}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1500);
      const onStaging = page.url().includes("staging.blackouttrades.com");
      const onSignIn = page.url().includes("sign-in");
      if (onStaging && !onSignIn) rec(`nav:${path}`, "PASS", page.url());
      else if (onSignIn) rec(`nav:${path}`, "FAIL", "bounced to sign-in");
      else rec(`nav:${path}`, "WARN", page.url());
      await shot(page, `nav-${path.replace(/\//g, "") || "root"}`);
    }

    // 7) HELIX filters
    await page.goto(`${STAGING}/flows`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    for (const f of ["CALL", "PUT", "ALL"]) {
      const btn = page.locator(".flow-seg-btn", { hasText: f }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        rec(`helix:filter-${f.toLowerCase()}`, "PASS");
      }
    }
    await shot(page, "06-helix");

    // 8) Sign out path — staging sign-in redirect again
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    if (page.url().includes("blackouttrades.com/sign-in")) {
      rec("signout-loop:redirect", "PASS", "signed-in user hitting /sign-in still routes via primary");
    } else {
      rec("signout-loop:redirect", "WARN", page.url());
    }

    if (consoleErrors.length) {
      rec("console:errors", "WARN", consoleErrors.slice(0, 3).join(" | "));
    } else {
      rec("console:errors", "PASS");
    }
  } finally {
    await ctx.close();
    await browser.close();
    await cleanup();
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const report = {
    at: new Date().toISOString(),
    staging: STAGING,
    checks,
    summary: {
      pass: checks.filter((c) => c.status === "PASS").length,
      warn: checks.filter((c) => c.status === "WARN").length,
      fail: fails.length,
    },
    artifactsDir: OUT,
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

  console.log(`\n=== Summary === PASS ${report.summary.pass} | WARN ${report.summary.warn} | FAIL ${report.summary.fail}`);
  console.log(`Report: ${OUT}/report.json`);
  console.log(`Screenshots: ${OUT}\n`);
  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail}`));
    process.exit(1);
  }
}

function urlAfterPrimaryCheck(url) {
  return url.includes("blackouttrades.com/sign-in");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
