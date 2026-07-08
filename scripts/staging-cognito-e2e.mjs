#!/usr/bin/env node
/**
 * Staging Cognito auth E2E — create temp admin user, sign in via Hosted UI, verify /admin.
 *
 * Usage: node scripts/staging-cognito-e2e.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.STAGING_COGNITO_E2E_DIR || "/opt/cursor/artifacts/staging-cognito-e2e";
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "";

mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

function loadCognitoConfig() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}"` +
      (REGION ? ` --region "${REGION}"` : "") +
      ` --query SecretString --output text`,
    { encoding: "utf8" }
  );
  const s = JSON.parse(raw);
  const poolId = s.COGNITO_USER_POOL_ID;
  const regionFromPool = poolId?.includes("_") ? poolId.split("_")[0] : REGION;
  return {
    poolId,
    clientId: s.COGNITO_CLIENT_ID,
    domain: s.COGNITO_DOMAIN,
    region: regionFromPool,
  };
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function createAdminUser(poolId, region, email, password) {
  const regionFlag = region ? ` --region "${region}"` : "";
  try {
    sh(
      `aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" ` +
        `--message-action SUPPRESS ` +
        `--user-attributes ` +
        `Name=email,Value="${email}" ` +
        `Name=email_verified,Value=true ` +
        `Name=custom:role,Value=admin ` +
        `Name=custom:tier,Value=premium` +
        regionFlag
    );
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? e);
    if (!/UsernameExistsException|already exists/i.test(msg)) throw e;
    sh(
      `aws cognito-idp admin-update-user-attributes --user-pool-id "${poolId}" --username "${email}" ` +
        `--user-attributes Name=custom:role,Value=admin Name=custom:tier,Value=premium` +
        regionFlag
    );
  }
  sh(
    `aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" ` +
      `--password "${password}" --permanent` +
      regionFlag
  );
}

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function main() {
  console.log(`\n=== Staging Cognito E2E ===`);
  console.log(`Target: ${STAGING}\n`);

  const { poolId, domain, region } = loadCognitoConfig();
  const email = process.env.COGNITO_E2E_EMAIL ?? `staging-cognito-e2e-${Date.now()}@blackouttrades.com`;
  const password = process.env.COGNITO_E2E_PASSWORD ?? `StagingE2e!${String(Date.now()).slice(-6)}`;

  console.log("--- Provision temp admin user ---");
  createAdminUser(poolId, region, email, password);
  rec("cognito:admin-user", "PASS", email);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  try {
    console.log("\n--- Sign-in redirect ---");
    const resp = await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    const url = page.url();
    if (url.includes("amazoncognito.com") || url.includes(`${domain}.auth.`)) {
      rec("redirect:cognito-hosted-ui", "PASS", url.slice(0, 120));
    } else if (url.includes("blackouttrades.com/sign-in")) {
      rec("redirect:cognito-hosted-ui", "FAIL", `still Clerk satellite: ${url}`);
    } else {
      rec("redirect:cognito-hosted-ui", "WARN", url);
    }
    await shot(page, "01-hosted-ui");

    console.log("\n--- Hosted UI login ---");
    await page.fill('input[name="username"], input[type="email"]', email);
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('input[name="signInSubmitButton"], button[type="submit"], input[type="submit"]');
    await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90_000 });
    rec("login:callback", "PASS", page.url());

    console.log("\n--- Admin gate ---");
    await page.goto(`${STAGING}/admin`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);
    const adminUrl = page.url();
    if (adminUrl.includes("/admin") && !adminUrl.includes("/sign-in")) {
      rec("admin:page", "PASS", adminUrl);
    } else {
      rec("admin:page", "FAIL", `redirected to ${adminUrl}`);
    }
    await shot(page, "02-admin");

    const meRes = await page.request.get(`${STAGING}/api/admin/me`);
    const me = await meRes.json().catch(() => ({}));
    if (meRes.ok() && me.admin) {
      rec("api:admin-me", "PASS", me.email ?? "");
    } else {
      rec("api:admin-me", "FAIL", JSON.stringify(me).slice(0, 120));
    }
  } finally {
    await browser.close();
    try {
      sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`);
      rec("cleanup:user", "PASS", email);
    } catch {
      rec("cleanup:user", "WARN", `delete ${email} manually`);
    }
  }

  const failed = checks.filter((c) => c.status === "FAIL").length;
  console.log(`\n=== ${failed ? "FAILED" : "PASSED"} (${checks.length} checks, ${failed} failures) ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
