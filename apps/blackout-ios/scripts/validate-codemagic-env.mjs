#!/usr/bin/env node
/**
 * Fail fast when Codemagic env vars drift from repo constants.
 * UI-defined env vars override codemagic.yaml — a wrong APPLE_TEAM_ID or BUNDLE_ID
 * produces "Unable to find signing certificate for team …" with the wrong team.
 */
import { APPLE_BUNDLE_ID } from "./ios-bundle-ids.mjs";

const EXPECTED_TEAM_ID = "ZA32C782N5";

const team = process.env.APPLE_TEAM_ID ?? "";
const bundle = process.env.BUNDLE_ID ?? "";
const fail = [];

if (team !== EXPECTED_TEAM_ID) {
  fail.push(
    `APPLE_TEAM_ID is "${team || "(unset)"}" — must be ${EXPECTED_TEAM_ID} (BLACKOUT TRADE LLC). ` +
      "Remove or fix Codemagic app/team env overrides that shadow codemagic.yaml.",
  );
}
if (bundle !== APPLE_BUNDLE_ID) {
  fail.push(
    `BUNDLE_ID is "${bundle || "(unset)"}" — must be ${APPLE_BUNDLE_ID}. ` +
      "Typo like com.blackout-trader.app will not match App Store Connect.",
  );
}

if (fail.length) {
  console.error("\n=== Codemagic signing env preflight FAILED ===\n");
  for (const line of fail) console.error(`  ✗ ${line}`);
  console.error("\nIntegration must be **BlackOut ASC** (API key on team ZA32C782N5, App Manager role).\n");
  process.exit(1);
}

console.log(`Codemagic signing env OK — team ${team}, bundle ${bundle}`);
