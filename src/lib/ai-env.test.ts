import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

describe("ai-env", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("largoBieOnly is true when LARGO_BIE_ONLY=1", async () => {
    process.env.LARGO_BIE_ONLY = "1";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { largoBieOnly } = await import("@/lib/ai-env");
    assert.equal(largoBieOnly(), true);
  });

  it("largoBieOnly is false on prod without opt-in", async () => {
    delete process.env.LARGO_BIE_ONLY;
    process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
    const { largoBieOnly, isStagingBieMode } = await import("@/lib/ai-env");
    assert.equal(isStagingBieMode(), false);
    assert.equal(largoBieOnly(), false);
  });
});
