#!/usr/bin/env node
/**
 * Lint Capacitor + Codemagic config before a cloud Mac build.
 * Runs on Linux/Windows — no Xcode required.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "../..");
const fail = [];

function read(path) {
  return readFileSync(path, "utf8");
}

const pkg = JSON.parse(read(join(appRoot, "package.json")));
const cap = read(join(appRoot, "capacitor.config.ts"));
const cm = read(join(repoRoot, "codemagic.yaml"));

const expected = {
  appId: "com.blackout-trades.app",
  appleId: "6787797476",
  teamId: "ZA32C782N5",
  ua: "BlackOutiOSApp",
  url: "https://blackouttrades.com",
  workingDir: "apps/blackout-ios",
};

if (!pkg.devDependencies?.typescript) {
  fail.push("devDependencies must include typescript (required for capacitor.config.ts on Codemagic)");
}
if (existsSync(join(appRoot, "capacitor.config.ts")) && !existsSync(join(appRoot, "node_modules/typescript/package.json"))) {
  fail.push("run npm install in apps/blackout-ios — typescript missing from node_modules");
}

if (!cap.includes(`appId: "${expected.appId}"`)) fail.push(`capacitor appId must be ${expected.appId}`);
if (!cap.includes(`appendUserAgent: "${expected.ua}"`)) fail.push(`appendUserAgent must be ${expected.ua}`);
if (!cap.includes(`url: "${expected.url}"`)) fail.push(`server.url must be ${expected.url}`);

if (!cm.includes(`APP_STORE_APPLE_ID: ${expected.appleId}`)) fail.push(`codemagic APP_STORE_APPLE_ID must be ${expected.appleId}`);
if (!cm.includes(`BUNDLE_ID: "${expected.appId}"`)) fail.push(`codemagic BUNDLE_ID must match appId`);
if (!cm.includes(`APPLE_TEAM_ID: "${expected.teamId}"`)) fail.push(`codemagic APPLE_TEAM_ID must be ${expected.teamId}`);
if (!cm.includes(`working_directory: ${expected.workingDir}`)) fail.push(`codemagic working_directory must be ${expected.workingDir}`);
if (!cm.includes("BlackOut ASC")) fail.push('Codemagic integration must be named "BlackOut ASC"');
if (cm.includes("ios_signing:")) fail.push("remove ios_signing from environment — signing runs in script (avoids early profile fetch failure)");

console.log("\n=== BlackOut iOS config validation ===\n");
if (fail.length) {
  for (const f of fail) console.log(`  ✗ ${f}`);
  console.log(`\nFAILED (${fail.length})\n`);
  process.exit(1);
}

console.log("  ✓ typescript devDependency (capacitor.config.ts)");
console.log("  ✓ appId / bundle ID");
console.log("  ✓ root codemagic.yaml (monorepo apps/blackout-ios)");
console.log("  ✓ Apple ID + Team ID");
console.log("  ✓ BlackOutiOSApp user-agent token");
console.log("  ✓ Production server.url");
console.log("\nGREEN — connect coreentryadmin-web/blackout-web in Codemagic.\n");
