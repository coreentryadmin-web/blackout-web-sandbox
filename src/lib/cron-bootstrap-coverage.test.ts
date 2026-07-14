import assert from "node:assert/strict";
import test from "node:test";

import { CRON_JOBS } from "./cron-registry";
// The Railway service map + derived provisioning bootstrap live in a plain .mjs (no Next/TS deps)
// so the cron trigger services can run them without the app build. Import directly.
import {
  ALL_CRON_KEYS,
  CRON_BOOTSTRAP,
  CRON_SERVICE_NAMES,
} from "../../scripts/railway-cron-services.mjs";

// Regression guard for the "registered but never provisioned → never ran" class that stranded
// vector-full-state-snapshot (#248) and bie-full-state-snapshot (#262). ensureCronService in
// railway-ops-provision.mjs is the ONLY automation that CREATES a missing Railway cron service,
// and it iterates CRON_BOOTSTRAP. If CRON_BOOTSTRAP ever regresses to a hand-curated subset, a
// newly-added cron's Railway service would silently never be created and the cron would never run.

test("CRON_BOOTSTRAP covers every registered cron job (no cron can be silently un-provisioned)", () => {
  const bootstrapKeys = new Set(CRON_BOOTSTRAP.map((b: { key: string }) => b.key));
  const missing = CRON_JOBS.map((j) => j.key).filter((k) => !bootstrapKeys.has(k));
  assert.deepEqual(
    missing,
    [],
    `every registry cron must be in the provisioner bootstrap; missing: ${missing.join(", ")}`
  );
});

test("CRON_BOOTSTRAP is derived from the service map (key + serviceName, no drift)", () => {
  assert.equal(CRON_BOOTSTRAP.length, ALL_CRON_KEYS.length);
  for (const { key, serviceName } of CRON_BOOTSTRAP as Array<{ key: string; serviceName: string }>) {
    assert.equal(
      serviceName,
      CRON_SERVICE_NAMES[key],
      `bootstrap serviceName for ${key} must equal its CRON_SERVICE_NAMES entry`
    );
  }
});

test("the two full-state snapshot crons are explicitly provisioned (the #58 ops-read regression)", () => {
  const keys = new Set(CRON_BOOTSTRAP.map((b: { key: string }) => b.key));
  assert.ok(keys.has("vector-full-state-snapshot"), "vector-full-state-snapshot must be bootstrapped");
  assert.ok(keys.has("bie-full-state-snapshot"), "bie-full-state-snapshot must be bootstrapped");
});
