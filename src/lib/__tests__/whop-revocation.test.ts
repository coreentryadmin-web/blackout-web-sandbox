import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Postgres-backed revocation denylist (Redis as hot cache). The load-bearing case
// is the REGRESSION test: a Redis miss/outage must fall through to Postgres — the
// old Redis-only storage silently un-revoked every refunded membership for the
// duration of any Redis outage. Run: npm test (needs --experimental-test-module-mocks).
//
// ESM caches the module under test after its first import, so the mocks are
// registered ONCE with implementations that delegate to this mutable `state`
// holder — each test swaps the state instead of re-mocking (re-mocking would be
// invisible to the already-cached module).

const state = {
  cache: new Map<string, number>(),
  cacheSetFails: false,
  dbRows: [] as string[],
  dbConfigured: true,
  dbThrows: false,
  dbCalls: [] as Array<{ text: string; values: unknown[] }>,
};

function resetState() {
  state.cache = new Map();
  state.cacheSetFails = false;
  state.dbRows = [];
  state.dbConfigured = true;
  state.dbThrows = false;
  state.dbCalls = [];
}

mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => (state.cache.has(key) ? state.cache.get(key) : null),
    sharedCacheSet: async (key: string, value: number) => {
      if (!state.cacheSetFails) state.cache.set(key, value);
    },
  },
});
mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async (text: string, values: unknown[]) => {
      state.dbCalls.push({ text, values });
      if (state.dbThrows) throw new Error("pg down");
      if (/SELECT/i.test(text)) {
        const id = String(values[0]);
        return { rows: state.dbRows.includes(id) ? [{ membership_id: id }] : [] };
      }
      return { rows: [] };
    },
  },
});

// No top-level await under tsx's CJS transform — lazy import; ESM caches it after
// the first call, so every test shares one module instance bound to the mocks above.
const mod = () => import("../whop-revocation");

test("Redis hit (1) short-circuits to revoked without touching Postgres", async () => {
  const { isMembershipRevoked } = await mod();
  resetState();
  state.cache.set("whop:revoked:mem_1", 1);
  assert.equal(await isMembershipRevoked("mem_1"), true);
  assert.equal(state.dbCalls.length, 0);
});

test("REGRESSION: Redis miss falls through to Postgres and still reports revoked", async () => {
  const { isMembershipRevoked } = await mod();
  resetState();
  state.dbRows = ["mem_2"];
  assert.equal(await isMembershipRevoked("mem_2"), true);
  // Backfills the hot cache so the next check skips Postgres.
  assert.equal(state.cache.get("whop:revoked:mem_2"), 1);
});

test("Redis miss + no Postgres row is not revoked, with a negative backfill", async () => {
  const { isMembershipRevoked } = await mod();
  resetState();
  assert.equal(await isMembershipRevoked("mem_3"), false);
  assert.equal(state.cache.get("whop:revoked:mem_3"), 0);
});

test("fresh negative cache (0) short-circuits without touching Postgres", async () => {
  const { isMembershipRevoked } = await mod();
  resetState();
  state.cache.set("whop:revoked:mem_4", 0);
  assert.equal(await isMembershipRevoked("mem_4"), false);
  assert.equal(state.dbCalls.length, 0);
});

test("mark: Postgres write succeeding is enough even when Redis verification fails", async () => {
  const { markMembershipRevoked } = await mod();
  resetState();
  state.cacheSetFails = true;
  await assert.doesNotReject(markMembershipRevoked("mem_5"));
});

test("mark: throws only when BOTH stores fail (webhook retry path)", async () => {
  const { markMembershipRevoked } = await mod();
  resetState();
  state.cacheSetFails = true;
  state.dbThrows = true;
  await assert.rejects(markMembershipRevoked("mem_6"), /Postgres and Redis both unavailable/);
});

test("db not configured degrades to Redis-only (no Postgres calls, no throw)", async () => {
  const { isMembershipRevoked, markMembershipRevoked } = await mod();
  resetState();
  state.dbConfigured = false;
  assert.equal(await isMembershipRevoked("mem_7"), false);
  await assert.doesNotReject(markMembershipRevoked("mem_7"));
  assert.equal(state.dbCalls.length, 0);
});
