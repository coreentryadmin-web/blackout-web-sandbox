#!/usr/bin/env node
/**
 * Set PRODUCT_BUNDLE_IDENTIFIER to the Apple-registered bundle ID after Capacitor
 * generates the ios/ project (Capacitor appId cannot contain hyphens).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLE_BUNDLE_ID } from "./ios-bundle-ids.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pbxPath = join(appRoot, "ios/App/App.xcodeproj/project.pbxproj");

if (!existsSync(pbxPath)) {
  console.error(`Missing ${pbxPath} — run npx cap add ios first`);
  process.exit(1);
}

let pbx = readFileSync(pbxPath, "utf8");
const before = pbx;
pbx = pbx.replace(
  /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
  `PRODUCT_BUNDLE_IDENTIFIER = ${APPLE_BUNDLE_ID};`,
);

if (pbx === before) {
  console.error("No PRODUCT_BUNDLE_IDENTIFIER entries found to patch");
  process.exit(1);
}

writeFileSync(pbxPath, pbx, "utf8");
console.log(`Patched Xcode bundle ID → ${APPLE_BUNDLE_ID}`);
