import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { callInternalApiRead } from "@/lib/bie/internal-api";

// These assertions all hit the GOVERNANCE gate, which returns BEFORE any network call — so the
// tests are deterministic and never touch the wire.
describe("callInternalApiRead — governance gate (no network on a denial)", () => {
  test("refuses a denied AREA (admin/cron/auth/webhook/push/membership/engine)", async () => {
    for (const p of [
      "/api/admin/spx/dashboard",
      "/api/cron/spx-evaluate",
      "/api/auth/cognito/login",
      "/api/webhook/whop",
      "/api/push/send",
      "/api/membership/sync",
      "/api/engine/whatever",
    ]) {
      const r = await callInternalApiRead(p);
      assert.equal(r.ok, false, `${p} must be refused`);
      assert.equal((r as { error: string }).error, "denied_not_read_allowlisted");
    }
  });

  test("refuses a cost/LLM/mutation route even though it's under an allowed area", async () => {
    for (const p of ["/api/market/largo/query", "/api/market/spx/commentary", "/api/track-record/publish"]) {
      const r = await callInternalApiRead(p);
      assert.equal(r.ok, false);
      assert.equal((r as { error: string }).error, "denied_not_read_allowlisted");
    }
  });

  test("refuses an unregistered path (deny by default)", async () => {
    const r = await callInternalApiRead("/api/market/some-unknown-endpoint");
    assert.equal(r.ok, false);
    assert.equal((r as { error: string }).error, "denied_not_read_allowlisted");
  });

  test("refuses a non-/api path outright", async () => {
    const r = await callInternalApiRead("https://evil.example.com/steal");
    assert.equal(r.ok, false);
    assert.equal((r as { error: string }).error, "invalid_path");
  });

  test("empty / non-string path is invalid, never fetched", async () => {
    assert.equal((await callInternalApiRead("")).ok, false);
    // @ts-expect-error — exercising a bad runtime input
    assert.equal((await callInternalApiRead(null)).ok, false);
  });
});
