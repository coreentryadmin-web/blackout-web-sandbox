#!/usr/bin/env node

/**
 * Vector end-to-end data validation across multiple strikes, OI, Flow.
 * Uses Cognito admin credentials to access staging endpoints.
 * Run with: env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/vector-data-validation.mjs
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";

const STAGING = "https://staging.blackouttrades.com";
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const TICKERS = ["SPX", "SPY", "NVDA", "AAPL"];
const DTES = ["0DTE", "WEEKLY", "MONTHLY"];

let passCount = 0;
let failCount = 0;
const failures = [];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function fail(msg) {
  console.error(`❌ FAIL: ${msg}`);
  failCount++;
  failures.push(msg);
}

function pass(msg) {
  console.log(`✅ PASS: ${msg}`);
  passCount++;
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function cognitoConfig() {
  const s = JSON.parse(
    sh(
      `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --region "${REGION}" --query SecretString --output text`
    )
  );
  const poolId = s.COGNITO_USER_POOL_ID;
  return { poolId, region: poolId?.includes("_") ? poolId.split("_")[0] : REGION };
}

function createTempUser(poolId, region, email, password) {
  const rf = region ? ` --region "${region}"` : "";
  try {
    sh(
      `aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" ` +
        `--message-action SUPPRESS --user-attributes Name=email,Value="${email}" ` +
        `Name=email_verified,Value=true Name=custom:role,Value=admin Name=custom:tier,Value=premium${rf}`
    );
  } catch (e) {
    if (!/UsernameExists|already exists/i.test(String(e))) throw e;
  }
  sh(`aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" --password "${password}" --permanent${rf}`);
}

function deleteTempUser(poolId, region, email) {
  try {
    sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`);
  } catch {
    /* best-effort cleanup */
  }
}

function randomPassword(prefix = "Bt") {
  return `${prefix}!${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2).toUpperCase()}9`;
}

async function signIn(page, email, password) {
  await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  const emailField = await page.locator('input[name="username"]:visible, input[type="email"]:visible').first();
  const passwordField = await page.locator('input[name="password"]:visible, input[type="password"]:visible').first();
  const submitBtn = await page
    .locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible')
    .first();

  await emailField.fill(email);
  await passwordField.fill(password);
  await submitBtn.click();
  await page.waitForURL((u) => u.href.startsWith(STAGING) && !u.href.includes("/sign-in"), { timeout: 90_000 });
}

async function apiGet(page, path) {
  try {
    const r = await page.request.get(`${STAGING}${path}`, { headers: { accept: "application/json" }, timeout: 30_000 });
    return r.ok() ? await r.json() : null;
  } catch (e) {
    console.error(`apiGet failed: ${e.message}`);
    return null;
  }
}

async function validateLadder(ladder, ticker, dte, spot) {
  if (!ladder || !Array.isArray(ladder.rows)) {
    fail(`${ticker} ${dte}: ladder invalid or missing rows`);
    return;
  }

  const rows = ladder.rows;
  if (rows.length === 0) {
    log(`${ticker} ${dte}: empty ladder (off-hours or thin chain)`);
    return;
  }

  // Validate descending strikes
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].strike >= rows[i - 1].strike) {
      fail(`${ticker} ${dte}: strikes not descending at row ${i} (${rows[i].strike} >= ${rows[i - 1].strike})`);
      return;
    }
  }
  pass(`${ticker} ${dte}: strikes descending (${rows.length} rows)`);

  // Validate magnitude and GEX
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.magnitude < 0 || row.magnitude > 1) {
      fail(`${ticker} ${dte}: row ${i} strike ${row.strike} magnitude out of range: ${row.magnitude}`);
      return;
    }
    if (!Number.isFinite(row.gex)) {
      fail(`${ticker} ${dte}: row ${i} strike ${row.strike} GEX not finite: ${row.gex}`);
      return;
    }
  }
  pass(`${ticker} ${dte}: magnitudes ∈ [0,1], GEX all finite`);

  // Validate king structure
  const calls = rows.filter((r) => r.side === "call");
  const puts = rows.filter((r) => r.side === "put");
  const callKings = calls.filter((r) => r.isKing);
  const putKings = puts.filter((r) => r.isKing);

  if (callKings.length > 1) fail(`${ticker} ${dte}: ${callKings.length} call kings (expect ≤1)`);
  if (putKings.length > 1) fail(`${ticker} ${dte}: ${putKings.length} put kings (expect ≤1)`);
  if (callKings.length + putKings.length > 0) {
    pass(`${ticker} ${dte}: king structure valid (${callKings.length} call @ ${callKings[0]?.strike ?? "—"}, ${putKings.length} put @ ${putKings[0]?.strike ?? "—"})`);
  }

  // Spot in band
  if (spot) {
    const high = rows[0].strike;
    const low = rows[rows.length - 1].strike;
    if (spot < low || spot > high) {
      fail(`${ticker} ${dte}: spot ${spot} outside band [${low}, ${high}]`);
      return;
    }
    pass(`${ticker} ${dte}: spot ${spot.toFixed(2)} in band`);
  }
}

async function validateFlow(flow, ticker, dte) {
  if (!flow) {
    log(`${ticker} ${dte}: no flow data returned`);
    return;
  }

  if (!flow.available) {
    log(`${ticker} ${dte}: flow unavailable — ${flow.reason ?? "unknown reason"}`);
    return;
  }

  const prints = flow.prints || [];
  if (prints.length === 0) {
    log(`${ticker} ${dte}: no large prints found`);
    return;
  }

  // Validate print structure
  let validPrints = 0;
  for (const print of prints) {
    if (!Number.isFinite(print.strike) || !Number.isFinite(print.premium)) {
      fail(`${ticker} ${dte}: malformed print — strike: ${print.strike}, premium: ${print.premium}`);
      return;
    }
    if (!["call", "put"].includes(print.side)) {
      fail(`${ticker} ${dte}: invalid side: ${print.side}`);
      return;
    }
    if (!Number.isFinite(print.size) || print.size <= 0) {
      fail(`${ticker} ${dte}: invalid size: ${print.size}`);
      return;
    }
    validPrints++;
  }

  pass(`${ticker} ${dte}: flow valid — ${validPrints} prints (expiry: ${flow.expiry ?? "—"}, found: ${flow.meta?.largeFound ?? 0}, truncated: ${flow.meta?.truncated ?? 0})`);
}

async function validateTicker(page, ticker, dte) {
  try {
    log(`\nValidating ${ticker} ${dte}...`);

    // GEX Ladder
    const gexRes = await apiGet(page, `/api/market/vector/gex-ladder?ticker=${ticker}&dte=${dte}`);
    if (!gexRes) {
      fail(`${ticker} ${dte}: gex-ladder API returned null`);
      return;
    }

    if (gexRes.error) {
      fail(`${ticker} ${dte}: gex-ladder error — ${gexRes.error}`);
      return;
    }

    await validateLadder(gexRes.ladder, ticker, dte, gexRes.spot);

    // Flow
    const flowRes = await apiGet(page, `/api/market/vector/flow?ticker=${ticker}&dte=${dte}`);
    if (!flowRes) {
      log(`${ticker} ${dte}: flow API returned null`);
    } else {
      await validateFlow(flowRes, ticker, dte);
    }
  } catch (e) {
    fail(`${ticker} ${dte}: ${e.message}`);
  }
}

async function validateCrossTickers(page) {
  try {
    log("\n=== Cross-Ticker Validation ===");
    const spxRes = await apiGet(page, "/api/market/vector/gex-ladder?ticker=SPX&dte=0DTE");
    const spyRes = await apiGet(page, "/api/market/vector/gex-ladder?ticker=SPY&dte=0DTE");

    if (spxRes?.spot && spyRes?.spot) {
      const ratio = spxRes.spot / spyRes.spot;
      if (ratio < 9 || ratio > 11) {
        fail(`SPX/SPY ratio ${ratio.toFixed(2)} outside expected ~10x`);
      } else {
        pass(`SPX/SPY ratio ${ratio.toFixed(2)} ✓`);
      }
    } else {
      log("SPX/SPY cross-check: missing spot data");
    }
  } catch (e) {
    fail(`Cross-ticker check: ${e.message}`);
  }
}

async function run() {
  log("=== Vector Comprehensive Data Validation ===");
  log(`Staging: ${STAGING}`);
  log(`Testing: ${TICKERS.join(", ")} × ${DTES.join(", ")}`);
  log("");

  const { poolId, region } = cognitoConfig();
  const email = `vector-validation-${Date.now()}@test.invalid`;
  const password = randomPassword();

  log(`Cognito pool: ${poolId} (region: ${region})`);
  log(`Creating temp user: ${email}`);

  createTempUser(poolId, region, email, password);

  const browser = await chromium.launch();
  let page;

  try {
    page = await browser.newPage();
    await signIn(page, email, password);
    log("✓ Signed in to staging\n");

    // Validate each ticker × DTE
    for (const ticker of TICKERS) {
      for (const dte of DTES) {
        await validateTicker(page, ticker, dte);
      }
    }

    // Cross-ticker checks
    await validateCrossTickers(page);
  } finally {
    if (page) await page.close();
    await browser.close();
    deleteTempUser(poolId, region, email);
    log("\n✓ Temp user deleted");
  }

  log("\n=== Summary ===");
  log(`✅ PASS: ${passCount}`);
  log(`❌ FAIL: ${failCount}`);
  if (failures.length > 0) {
    log("\nFailures:");
    failures.forEach((f) => log(`  - ${f}`));
  }

  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
