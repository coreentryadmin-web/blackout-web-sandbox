import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("loadSpxDesk and loadMergedSpxDesk share exactly one buildSpxDesk cache lane (regression: cache-key race let the member dashboard and trade-alert panel disagree on trade direction)", async () => {
  let buildCount = 0;
  mock.module("../providers/spx-desk", {
    namedExports: {
      buildSpxDesk: async () => ({ marker: ++buildCount }),
      buildSpxDeskFlow: async () => ({ available: false }),
      buildSpxDeskPulse: async () => ({ available: false }),
    },
  });
  // A fixed, test-only session date so this test's cache entries can never collide with a
  // real "today" key used elsewhere in the process.
  mock.module("../providers/spx-session", {
    namedExports: {
      todayEtYmd: () => "2099-01-01",
    },
  });
  mock.module("../spx-desk-merge", {
    namedExports: {
      mergeDeskLayers: (desk: unknown) => desk,
    },
  });

  const { loadSpxDesk, loadMergedSpxDesk } = await import("../spx-desk-loader");

  const fromStandaloneLoader = await loadSpxDesk();
  const fromMergedLoader = (await loadMergedSpxDesk()).desk;

  // The regression: the standalone /api/market/spx/desk route used to cache buildSpxDesk()
  // under a bare "spx-desk" key while this loader used "spx-desk:${date}" — two
  // independently-expiring lanes, each invoking buildSpxDesk() on its own schedule against a
  // live WS tide store. If that key mismatch ever comes back, buildSpxDesk runs twice here
  // and the two results are different objects.
  assert.equal(
    buildCount,
    1,
    "buildSpxDesk ran more than once — loadSpxDesk() and loadMergedSpxDesk() are using different cache keys again"
  );
  assert.deepEqual(fromStandaloneLoader, fromMergedLoader);

  mock.restoreAll();
});
