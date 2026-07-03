import { test } from "node:test";
import assert from "node:assert/strict";
import { toJsonbParam, buildSourceApisAttribution } from "./db";

test("toJsonbParam: an array serializes to a real JSON array, not a Postgres array literal", () => {
  const arr = [{ check: "a", passed: true, value: 1, threshold: 2 }];
  const out = toJsonbParam(arr);
  assert.equal(out, '[{"check":"a","passed":true,"value":1,"threshold":2}]');
  // The bug this fixes: passing the raw array to node-postgres's default parameter
  // serialization produces a Postgres ARRAY-literal string like {"..."} that is NOT
  // valid JSON. Confirm the actual output parses back to the original value.
  assert.deepEqual(JSON.parse(out), arr);
});

test("toJsonbParam: an object serializes identically to plain JSON.stringify", () => {
  const obj = { foo: "bar", n: 1 };
  assert.equal(toJsonbParam(obj), JSON.stringify(obj));
});

test("toJsonbParam: null and undefined both become a real null, not the string \"null\"", () => {
  assert.equal(toJsonbParam(null), null);
  assert.equal(toJsonbParam(undefined), null);
});

test("toJsonbParam: an empty array still round-trips (not treated as null)", () => {
  assert.equal(toJsonbParam([]), "[]");
});

test("buildSourceApisAttribution: matches telemetry rows whose request_url contains the ticker", () => {
  const rows = [
    { provider: "unusualwhales", endpoint: "/flow-alerts", rate_limited: false, ok: true, request_url: "https://api.unusualwhales.com/flow-alerts?ticker=NVDA" },
    { provider: "polygon", endpoint: "/v3/quote", rate_limited: false, ok: true, request_url: "https://api.polygon.io/v3/quote/AAPL" },
  ];
  const result = buildSourceApisAttribution("NVDA", rows);
  assert.deepEqual(result, [
    { provider: "unusualwhales", endpoint: "/flow-alerts", rate_limited: false, ok: true, best_effort: true },
  ]);
});

test("buildSourceApisAttribution: no matches returns null, not an empty array", () => {
  const rows = [{ provider: "polygon", endpoint: "/v3/quote", rate_limited: false, ok: true, request_url: "https://api.polygon.io/v3/quote/AAPL" }];
  assert.equal(buildSourceApisAttribution("NVDA", rows), null);
});

test("buildSourceApisAttribution: null request_url never matches", () => {
  const rows = [{ provider: "polygon", endpoint: "/v3/quote", rate_limited: false, ok: true, request_url: null }];
  assert.equal(buildSourceApisAttribution("AAPL", rows), null);
});

test("buildSourceApisAttribution: dedups repeated calls to the same provider+endpoint", () => {
  const rows = [
    { provider: "polygon", endpoint: "/v3/quote", rate_limited: false, ok: true, request_url: "...NVDA..." },
    { provider: "polygon", endpoint: "/v3/quote", rate_limited: true, ok: false, request_url: "...NVDA..." },
  ];
  const result = buildSourceApisAttribution("NVDA", rows);
  assert.equal(result?.length, 1);
  // First occurrence wins — retries after the initial success don't overwrite it.
  assert.equal(result?.[0].rate_limited, false);
});

test("buildSourceApisAttribution: ticker match is case-insensitive", () => {
  const rows = [{ provider: "polygon", endpoint: "/v3/quote", rate_limited: false, ok: true, request_url: "https://api.polygon.io/v3/quote/nvda" }];
  assert.equal(buildSourceApisAttribution("NVDA", rows)?.length, 1);
});

test("buildSourceApisAttribution: every entry is marked best_effort — never claims exactness", () => {
  const rows = [{ provider: "polygon", endpoint: "/v3/quote", rate_limited: false, ok: true, request_url: "...NVDA..." }];
  const result = buildSourceApisAttribution("NVDA", rows);
  assert.equal(result?.every((r) => r.best_effort === true), true);
});
