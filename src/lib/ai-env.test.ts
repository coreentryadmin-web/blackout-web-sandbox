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

  it("staging + STAGING_LARGO_CLAUDE skips BIE router and enables Largo Claude gate", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    process.env.STAGING_LARGO_CLAUDE = "1";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const { largoSkipBieRouter, largoBieOnly, largoClaudeEnabled, claudeEnabled } = await import(
      "@/lib/ai-env"
    );
    assert.equal(claudeEnabled(), false, "global Claude stays off");
    assert.equal(largoClaudeEnabled(), true);
    assert.equal(largoSkipBieRouter(), true);
    assert.equal(largoBieOnly(), false);
  });

  it("LARGO_BIE_FIRST keeps BIE router on staging Largo Claude", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    process.env.STAGING_LARGO_CLAUDE = "1";
    process.env.LARGO_BIE_FIRST = "1";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const { largoSkipBieRouter } = await import("@/lib/ai-env");
    assert.equal(largoSkipBieRouter(), false);
  });
});
