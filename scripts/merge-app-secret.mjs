#!/usr/bin/env node
/**
 * Merge an env file into an AWS Secrets Manager JSON secret.
 *
 * Usage:
 *   node scripts/merge-app-secret.mjs \
 *     --secret-name blackout-production/app/env \
 *     --env-file ./production.env \
 *     [--region us-east-1] \
 *     [--dry-run]
 *
 * Reads the existing secret JSON, merges new keys from the env file
 * (new keys are added, existing keys are overwritten), and writes back.
 * Terraform's lifecycle { ignore_changes = [secret_string] } prevents
 * `terraform apply` from reverting these additions.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}
const dryRun = args.includes("--dry-run");

const secretName = flag("secret-name");
const envFile = flag("env-file");
const region = flag("region") || "us-east-1";

if (!secretName || !envFile) {
  console.error(
    "Usage: node scripts/merge-app-secret.mjs --secret-name <name> --env-file <path> [--region <r>] [--dry-run]"
  );
  process.exit(1);
}

function parseEnvFile(path) {
  const lines = readFileSync(path, "utf-8").split("\n");
  const env = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const newKeys = parseEnvFile(envFile);
const newCount = Object.keys(newKeys).length;
console.log(`Parsed ${newCount} keys from ${envFile}`);

if (newCount === 0) {
  console.error("No keys found in env file. Aborting.");
  process.exit(1);
}

let existing = {};
try {
  const raw = execFileSync(
    "aws",
    [
      "secretsmanager", "get-secret-value",
      "--secret-id", secretName,
      "--region", region,
      "--query", "SecretString",
      "--output", "text",
    ],
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  existing = JSON.parse(raw);
  console.log(
    `Existing secret has ${Object.keys(existing).length} keys`
  );
} catch (e) {
  console.log("No existing secret found — will create fresh.");
}

const merged = { ...existing, ...newKeys };
const mergedCount = Object.keys(merged).length;
const added = Object.keys(newKeys).filter((k) => !(k in existing));
const updated = Object.keys(newKeys).filter(
  (k) => k in existing && existing[k] !== newKeys[k]
);
const unchanged = Object.keys(newKeys).filter(
  (k) => k in existing && existing[k] === newKeys[k]
);

console.log(`\nMerge summary:`);
console.log(`  Added:     ${added.length} new keys`);
console.log(`  Updated:   ${updated.length} keys (value changed)`);
console.log(`  Unchanged: ${unchanged.length} keys`);
console.log(`  Total:     ${mergedCount} keys in merged secret`);

if (added.length) console.log(`\n  New keys: ${added.join(", ")}`);
if (updated.length)
  console.log(`  Updated keys: ${updated.join(", ")}`);

if (dryRun) {
  console.log("\n--dry-run: not writing. Merged JSON:");
  const redacted = {};
  for (const [k, v] of Object.entries(merged)) {
    redacted[k] =
      typeof v === "string" && v.length > 8
        ? v.slice(0, 4) + "...[REDACTED]"
        : "[SET]";
  }
  console.log(JSON.stringify(redacted, null, 2));
  process.exit(0);
}

const secretJson = JSON.stringify(merged);
try {
  execFileSync(
    "aws",
    [
      "secretsmanager", "put-secret-value",
      "--secret-id", secretName,
      "--secret-string", secretJson,
      "--region", region,
    ],
    { stdio: "inherit" }
  );
  console.log(`\nSecret "${secretName}" updated (${mergedCount} keys).`);
  console.log(
    "Run: aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment"
  );
} catch (e) {
  console.error("Failed to write secret:", e.message);
  process.exit(1);
}
