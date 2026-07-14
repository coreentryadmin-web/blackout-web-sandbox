import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// fix/spx-slayer-desk-coherence — /api/market/spx/pulse was the ONLY SPX route serving its payload
// WITHOUT roundFloats (every sibling — desk/merged/play/signals/bootstrap/power-hour/outcomes — wraps
// its response). The pulse build serves raw GEX/greek/price floats (gex_net, gamma_flip, dark-pool
// notionals) carrying IEEE-754 noise (7499.360000000001). This asserts the response is now shaped:
// no numeric value survives with more than 4 decimal places, and the classic noisy value is rounded.
//
// mock.module() resolves relative specifiers to the SAME absolute module the route imports via "@/"
// (tsx maps both to one URL), so mocking the relative path intercepts the alias import — same pattern
// as src/app/api/market/regime/route.test.ts. loadSpxDeskPulse is faked to return a noisy fixture;
// ensureDataSockets/auth are stubbed so the route runs without real sockets or a session.

let mockPulse: Record<string, unknown> = {};

mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "test-user" }),
  },
});
mock.module("../../../../../lib/ws/init-data-sockets", {
  namedExports: {
    ensureDataSockets: () => {},
  },
});
mock.module("../../../../../features/spx/lib/spx-desk-loader", {
  namedExports: {
    loadSpxDeskPulse: async () => mockPulse,
  },
});

/** Recursively collect any number whose decimal expansion has > maxDp places. */
function overPrecisionValues(value: unknown, maxDp = 4, path = "$"): string[] {
  const hits: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === "number") {
      if (Number.isFinite(v) && !Number.isInteger(v)) {
        const dp = (String(v).split(".")[1] ?? "").length;
        if (dp > maxDp) hits.push(`${p}=${v} (${dp}dp)`);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, `${p}.${k}`);
    }
  };
  walk(value, path);
  return hits;
}

describe("/api/market/spx/pulse GET rounds floats at the response boundary", () => {
  let GET: (req: unknown) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("no value in the response carries more than 4 decimal places", async () => {
    mockPulse = {
      available: true,
      polled_at: "2026-07-14T14:00:00.000Z",
      price: 7499.360000000001,
      gex_net: -12701691969.618551,
      gamma_flip: 7480.123456789,
      above_gamma_flip: true,
      gamma_regime: "amplification",
      gex_walls: [{ strike: 7500, kind: "resistance", net_gex: 400000000.3333333 }],
      dark_pool: { notional: 123456.7890123, updatedAt: 1752501600000 },
      lit_dark_ratio: 0.6666666666666666,
      net_prem_ticks: [{ t: 1752501600000, v: 88.99999999999 }],
    };
    const res = await GET({});
    const body = await res.json();

    const offenders = overPrecisionValues(body);
    assert.deepEqual(offenders, [], `unrounded floats leaked: ${offenders.join(", ")}`);
  });

  test("the classic IEEE-754 noise value is rounded to 2dp (data-layer convention)", async () => {
    mockPulse = { available: true, price: 7499.360000000001, gex_net: -12701691969.618551 };
    const res = await GET({});
    const body = await res.json();
    assert.equal(body.price, 7499.36);
    assert.equal(body.gex_net, -12701691969.62);
  });

  test("integers (epoch-ms timestamps, counts) pass through untouched", async () => {
    mockPulse = { available: true, polled_at: "2026-07-14T14:00:00.000Z", gex_age_ms: 1752501600000 };
    const res = await GET({});
    const body = await res.json();
    assert.equal(body.gex_age_ms, 1752501600000);
  });
});
