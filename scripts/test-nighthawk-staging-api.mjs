#!/usr/bin/env node
/**
 * Night Hawk staging API test — direct validation of play generation.
 * Uses CRON_SECRET from staging secrets for direct API auth.
 */
import { execSync } from "node:child_process";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function loadStagingSecret() {
  try {
    const raw = sh(
      `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`
    );
    return JSON.parse(raw);
  } catch (e) {
    console.error("❌ Failed to load staging secrets:", e.message);
    console.log("   Make sure AWS credentials are configured and you have access to:", SECRET_NAME);
    process.exit(1);
  }
}

async function testNightHawkPlayGeneration() {
  console.log("🚀 Night Hawk Staging Play Generation Test");
  console.log("=".repeat(60));

  const secret = loadStagingSecret();
  const bearer = secret.CRON_SECRET?.trim();

  if (!bearer) {
    console.error("❌ CRON_SECRET not found in staging secrets");
    process.exit(1);
  }

  console.log(`✓ Loaded staging credentials`);

  const headers = {
    "Authorization": `Bearer ${bearer}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  // Test Night Hawk edition endpoint
  console.log("\n📊 Testing Night Hawk edition endpoint...");
  try {
    const res = await fetch(`${BASE}/api/market/nighthawk/edition`, { headers, cache: "no-store" });

    if (!res.ok) {
      console.error(`❌ HTTP ${res.status} from Night Hawk endpoint`);
      console.log("   Response:", await res.text().then(t => t.slice(0, 200)));
      process.exit(1);
    }

    const data = await res.json();
    const plays = data?.plays ?? [];

    console.log(`✓ Fetched Night Hawk edition: ${plays.length} plays`);

    if (plays.length === 0) {
      console.error("❌ Zero plays generated!");
      console.log("   This indicates G-N3 gate fix may not be working.");
      console.log("   Night Hawk should generate plays off-hours after the fix.");
      process.exit(1);
    }

    console.log("\n📋 Generated Plays:");
    console.log("-".repeat(60));

    for (const play of plays.slice(0, 5)) {
      const tier = play.tier ?? "unknown";
      const ticker = play.ticker ?? "?";
      const dte = play.dte ?? "?";
      const score = play.score?.toFixed(0) ?? "?";
      const evidence = play.evidence?.length ?? 0;
      console.log(`  ${ticker.padEnd(6)} ${dte.padEnd(8)} tier=${tier} score=${score} evidence=${evidence}`);
    }

    if (plays.length > 5) {
      console.log(`  ... and ${plays.length - 5} more`);
    }

    // Validate structure
    console.log("\n✅ Validating play structure...");
    const failures = [];
    for (const play of plays) {
      if (!play.ticker) failures.push("missing ticker");
      if (play.tier === undefined) failures.push("missing tier");
      if (typeof play.score !== "number") failures.push("missing/invalid score");
      if (!Array.isArray(play.evidence)) failures.push("missing evidence array");
    }

    if (failures.length) {
      console.error(`❌ Structure validation failed: ${[...new Set(failures)].join(", ")}`);
      console.log("   Play structure:", JSON.stringify(plays[0], null, 2).slice(0, 300));
      process.exit(1);
    }

    console.log("✓ All plays have valid structure");

    // Test SPX play endpoint for comparison
    console.log("\n📊 Testing SPX play endpoint (for comparison)...");
    const spxRes = await fetch(`${BASE}/api/market/spx/play`, { headers, cache: "no-store" });
    if (spxRes.ok) {
      const spxData = await spxRes.json();
      const action = spxData?.action ?? "none";
      const score = spxData?.score ?? "?";
      console.log(`✓ SPX play: action=${action} score=${score}`);
    } else {
      console.warn(`⚠ SPX endpoint returned ${spxRes.status}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ SUCCESS: Night Hawk plays generating correctly on staging");
    console.log("   · G-N3 gate fix is working (plays being published)");
    console.log("   · Play structure is valid");
    console.log("   · Ready for production deployment");
    process.exit(0);

  } catch (e) {
    console.error("❌ Test failed:", e.message);
    process.exit(1);
  }
}

testNightHawkPlayGeneration();
