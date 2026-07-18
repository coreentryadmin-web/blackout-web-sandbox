#!/usr/bin/env node
/**
 * Sync secrets from staging to production.
 *
 * Reads both secrets, diffs keys, and merges staging values into production
 * for keys that are environment-agnostic (API keys, shared config).
 * Keys that are environment-specific (URLs, Clerk, site identity) are
 * flagged but NOT copied — they need production-specific values.
 *
 * Usage:
 *   node scripts/sync-secrets-staging-to-prod.mjs [--dry-run] [--apply]
 *
 * Default is --dry-run. Pass --apply to actually write to production.
 */

import { execFileSync } from "node:child_process";

const REGION = "us-east-1";
const STAGING_SECRET = "blackout-staging/app/env";
const PROD_SECRET = "blackout-production/app/env";

const apply = process.argv.includes("--apply");

// Keys that MUST have production-specific values (never copy from staging)
const PROD_SPECIFIC_KEYS = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "HOSTNAME",
  "NODE_ENV",
  "PORT",
  "REPLICA_COUNT",
  "PGBOUNCER_DEFAULT_POOL_SIZE",
  "PG_POOL_MAX",
  "CRON_SECRET",
  // Clerk: production uses its own Clerk instance
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_IS_SATELLITE",
  "CLERK_WEBHOOK_SECRET",
  // Cognito: staging-only (production uses Clerk, not Cognito)
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_ID",
  "COGNITO_CLIENT_SECRET",
  "COGNITO_DOMAIN",
  "COGNITO_ISSUER",
  "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
  "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  "NEXT_PUBLIC_COGNITO_DOMAIN",
  "NEXT_PUBLIC_AUTH_PROVIDER",
  // Site identity
  "NEXT_PUBLIC_SITE_URL",
  "CRON_TARGET_BASE_URL",
  // Sentry (separate project for prod)
  "SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "NEXT_PUBLIC_SENTRY_DSN",
]);

// Keys to NEVER copy (staging-only infrastructure)
const SKIP_KEYS = new Set([
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_ID",
  "COGNITO_CLIENT_SECRET",
  "COGNITO_DOMAIN",
  "COGNITO_ISSUER",
  "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
  "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  "NEXT_PUBLIC_COGNITO_DOMAIN",
  "NEXT_PUBLIC_AUTH_PROVIDER",
]);

function readSecret(secretId) {
  try {
    const raw = execFileSync("aws", [
      "secretsmanager", "get-secret-value",
      "--secret-id", secretId,
      "--region", REGION,
      "--query", "SecretString",
      "--output", "text",
    ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function redact(val) {
  if (typeof val !== "string") return "[SET]";
  if (val.length > 8) return val.slice(0, 4) + "...[REDACTED]";
  return "[SET]";
}

console.log("=== BlackOut Secrets Sync: Staging → Production ===\n");

// 1. Read both
console.log(`Reading staging secret: ${STAGING_SECRET}`);
const staging = readSecret(STAGING_SECRET);
if (!staging) {
  console.error("Failed to read staging secret. Check AWS credentials.");
  process.exit(1);
}
console.log(`  → ${Object.keys(staging).length} keys\n`);

console.log(`Reading production secret: ${PROD_SECRET}`);
const prod = readSecret(PROD_SECRET);
if (!prod) {
  console.error("Failed to read production secret. Check AWS credentials.");
  process.exit(1);
}
console.log(`  → ${Object.keys(prod).length} keys\n`);

// 2. Diff
const stagingKeys = new Set(Object.keys(staging));
const prodKeys = new Set(Object.keys(prod));

const missingInProd = [...stagingKeys].filter((k) => !prodKeys.has(k)).sort();
const extraInProd = [...prodKeys].filter((k) => !stagingKeys.has(k)).sort();
const common = [...stagingKeys].filter((k) => prodKeys.has(k)).sort();

console.log("=== KEY DIFF ===");
console.log(`  Common:              ${common.length}`);
console.log(`  Missing in prod:     ${missingInProd.length}`);
console.log(`  Extra in prod only:  ${extraInProd.length}\n`);

if (missingInProd.length === 0) {
  console.log("Production has all staging keys. Nothing to sync.");
  process.exit(0);
}

// 3. Categorize missing keys
const toCopy = [];
const needsManual = [];
const toSkip = [];

for (const key of missingInProd) {
  if (SKIP_KEYS.has(key)) {
    toSkip.push(key);
  } else if (PROD_SPECIFIC_KEYS.has(key)) {
    needsManual.push(key);
  } else {
    toCopy.push(key);
  }
}

console.log("=== MISSING IN PRODUCTION ===\n");

if (toCopy.length) {
  console.log(`WILL COPY from staging (${toCopy.length} keys — safe to share):`);
  for (const k of toCopy) {
    console.log(`  ✓ ${k} = ${redact(staging[k])}`);
  }
  console.log();
}

if (needsManual.length) {
  console.log(
    `NEEDS PRODUCTION VALUE (${needsManual.length} keys — cannot copy staging value):`
  );
  for (const k of needsManual) {
    console.log(`  ⚠ ${k} (staging: ${redact(staging[k])})`);
  }
  console.log();
}

if (toSkip.length) {
  console.log(
    `SKIPPING (${toSkip.length} keys — staging-only, not needed in prod):`
  );
  for (const k of toSkip) {
    console.log(`  ✗ ${k}`);
  }
  console.log();
}

if (extraInProd.length) {
  console.log(`EXTRA IN PROD ONLY (${extraInProd.length} keys — already there):`);
  for (const k of extraInProd) {
    console.log(`  → ${k} = ${redact(prod[k])}`);
  }
  console.log();
}

// 4. Merge (only safe-to-copy keys)
if (toCopy.length === 0) {
  console.log("No keys safe to auto-copy. Set the manual ones above, then re-run.");
  process.exit(0);
}

const merged = { ...prod };
for (const k of toCopy) {
  merged[k] = staging[k];
}

console.log(`\n=== MERGE PLAN ===`);
console.log(`  Current prod keys:  ${Object.keys(prod).length}`);
console.log(`  Adding:             ${toCopy.length}`);
console.log(`  Result:             ${Object.keys(merged).length} keys`);

if (!apply) {
  console.log("\n--dry-run mode (default). To apply, run with --apply");
  console.log("\nMerged key list:");
  for (const k of Object.keys(merged).sort()) {
    const source = toCopy.includes(k)
      ? " ← NEW (from staging)"
      : prodKeys.has(k)
        ? ""
        : " ← NEW";
    console.log(`  ${k}${source}`);
  }

  if (needsManual.length) {
    console.log(
      `\n⚠ ${needsManual.length} keys still need production values before the app is fully configured:`
    );
    for (const k of needsManual) console.log(`  ${k}`);
    console.log(
      "\nUse the merge script to add them:\n  node scripts/merge-app-secret.mjs --secret-name blackout-production/app/env --env-file ./production.env"
    );
  }
  process.exit(0);
}

// Apply
console.log("\nWriting merged secret to production...");
const secretJson = JSON.stringify(merged);
try {
  execFileSync("aws", [
    "secretsmanager", "put-secret-value",
    "--secret-id", PROD_SECRET,
    "--secret-string", secretJson,
    "--region", REGION,
  ], { stdio: "inherit" });
  console.log(`\n✓ Production secret updated (${Object.keys(merged).length} keys).`);
  console.log(
    "Run: aws ecs update-service --cluster blackout-production-cluster --service blackout-production-web --force-new-deployment"
  );
} catch (e) {
  console.error("Failed to write production secret:", e.message);
  process.exit(1);
}

if (needsManual.length) {
  console.log(
    `\n⚠ ${needsManual.length} keys still need production-specific values:`
  );
  for (const k of needsManual) console.log(`  ${k}`);
  console.log(
    "\nFill in production.env and run:\n  node scripts/merge-app-secret.mjs --secret-name blackout-production/app/env --env-file ./production.env"
  );
}
