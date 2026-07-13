import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ROUTES,
  DENIED_AREA_PREFIXES,
  isDeniedAreaPath,
  routeFor,
  isReadAllowed,
  readAllowedPaths,
  routeRegistryKnowledgeText,
} from "@/lib/route-registry";

describe("route-registry — governance model", () => {
  test("every route is well-formed and GET-only", () => {
    for (const r of ROUTES) {
      assert.match(r.path, /^\/api\//, `${r.path} must be an /api/ path`);
      assert.deepEqual(r.methods, ["GET"], `${r.path} must be GET-only`);
      assert.ok(["read", "mutation"].includes(r.class));
      assert.ok(r.description.length > 8, `${r.path} needs a description`);
    }
  });

  test("no route lives under a denied area (admin/cron/auth/webhook/push/membership/engine)", () => {
    for (const r of ROUTES) {
      assert.ok(!isDeniedAreaPath(r.path), `${r.path} is under a denied area and must not be registered`);
    }
  });

  test("isReadAllowed: GET on a class:read route passes", () => {
    assert.equal(isReadAllowed("/api/market/gex-positioning"), true);
    assert.equal(isReadAllowed("/api/market/vector/walls?ticker=NVDA&dte=all"), true, "query string ignored");
    assert.equal(isReadAllowed("/api/market/quote/AAPL"), true, "sub-resource of a read route");
    assert.equal(isReadAllowed("/api/market/spx/desk"), true);
  });

  test("isReadAllowed: non-GET is always refused, even on a read route", () => {
    assert.equal(isReadAllowed("/api/market/gex-positioning", "POST"), false);
    assert.equal(isReadAllowed("/api/market/spx/journal", "PUT"), false);
    assert.equal(isReadAllowed("/api/market/vector/walls", "DELETE"), false);
  });

  test("FIREWALL: denied areas are refused regardless of method", () => {
    for (const p of [
      "/api/admin/spx/dashboard",
      "/api/cron/spx-evaluate",
      "/api/auth/cognito/login",
      "/api/webhook/whop",
      "/api/webhooks/clerk",
      "/api/push/send",
      "/api/membership/sync",
      "/api/engine/anything/here",
    ]) {
      assert.equal(isReadAllowed(p, "GET"), false, `${p} must be denied`);
      assert.ok(isDeniedAreaPath(p), `${p} must be a denied area`);
    }
  });

  test("FIREWALL: cost/LLM + write routes are class:mutation and refused", () => {
    for (const p of [
      "/api/market/largo/query",
      "/api/market/spx/commentary",
      "/api/market/nighthawk/hunt",
      "/api/market/nighthawk/play-explain",
      "/api/track-record/publish",
      "/api/market/anomalies",
    ]) {
      assert.equal(isReadAllowed(p, "GET"), false, `${p} must be denied (mutation/cost)`);
      assert.equal(routeFor(p)?.class, "mutation");
    }
  });

  test("an unregistered path is denied by default", () => {
    assert.equal(isReadAllowed("/api/market/some-new-thing"), false);
    assert.equal(isReadAllowed("/api/totally/unknown"), false);
    assert.equal(routeFor("/api/totally/unknown"), null);
  });

  test("readAllowedPaths returns only class:read routes; knowledge text lists them", () => {
    const paths = readAllowedPaths();
    assert.ok(paths.length >= 20);
    assert.ok(paths.every((p) => !isDeniedAreaPath(p)));
    assert.ok(!paths.includes("/api/market/largo/query"), "cost route not in read allowlist");
    const text = routeRegistryKnowledgeText();
    assert.match(text, /gex-positioning/);
    assert.match(text, /Denied areas/);
  });

  test("DENIED_AREA_PREFIXES covers the mandated firewall set", () => {
    for (const pre of ["/api/admin", "/api/cron", "/api/auth", "/api/push", "/api/membership", "/api/engine"]) {
      assert.ok(DENIED_AREA_PREFIXES.includes(pre), `${pre} must be denied`);
    }
    assert.ok(DENIED_AREA_PREFIXES.some((p) => p.startsWith("/api/webhook")));
  });
});
