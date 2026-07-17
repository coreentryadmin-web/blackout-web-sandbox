import assert from "node:assert/strict";
import test from "node:test";
import { auditEnvVarKeys, probeRuntimeEnvVars } from "./platform-env-audit";

test("auditEnvVarKeys: flags missing critical vars, counts total regardless of which are critical", () => {
  assert.deepEqual(auditEnvVarKeys(["DATABASE_URL", "SOME_OTHER_VAR"], ["DATABASE_URL", "REDIS_URL"]), {
    total_count: 2,
    missing_critical: ["REDIS_URL"],
  });
});

test("auditEnvVarKeys: nothing missing when every critical var is present", () => {
  assert.deepEqual(auditEnvVarKeys(["DATABASE_URL", "REDIS_URL"], ["DATABASE_URL", "REDIS_URL"]), {
    total_count: 2,
    missing_critical: [],
  });
});

test("probeRuntimeEnvVars: audits process.env keys only", () => {
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://local/test";
  try {
    const audit = probeRuntimeEnvVars();
    assert.equal(audit.ok, true);
    assert.ok(audit.total_count >= 1);
    assert.equal(audit.missing_critical.includes("DATABASE_URL"), false);
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});
