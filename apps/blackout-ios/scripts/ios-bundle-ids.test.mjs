import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPACITOR_APP_ID, APPLE_BUNDLE_ID } from "./ios-bundle-ids.mjs";

const CAP_APP_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Capacitor appId has no hyphens", () => {
  assert.match(CAPACITOR_APP_ID, CAP_APP_ID_RE);
  assert.doesNotMatch(CAPACITOR_APP_ID, /-/);
});

test("Apple bundle ID matches Codemagic BUNDLE_ID", () => {
  const cm = readFileSync(join(appRoot, "../../codemagic.yaml"), "utf8");
  assert.ok(cm.includes(`BUNDLE_ID: "${APPLE_BUNDLE_ID}"`));
});

test("capacitor.config.ts uses Capacitor appId constant", () => {
  const cap = readFileSync(join(appRoot, "capacitor.config.ts"), "utf8");
  assert.ok(cap.includes(`appId: "${CAPACITOR_APP_ID}"`));
});
