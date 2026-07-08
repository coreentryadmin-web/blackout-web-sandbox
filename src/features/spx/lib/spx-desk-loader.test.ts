import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("loadSpxDesk, loadSpxDeskPulse, and loadSpxDeskFlow share one cache lane each with loadMergedSpxDesk (regression: bare keys raced date-scoped loader keys)", async () => {
  let deskCount = 0;
  let pulseCount = 0;
  let flowCount = 0;
  mock.module("./spx-desk", {
    namedExports: {
      buildSpxDesk: async () => ({ marker: ++deskCount }),
      buildSpxDeskFlow: async () => ({ marker: ++flowCount }),
      buildSpxDeskPulse: async () => ({ marker: ++pulseCount }),
    },
  });
  // A fixed, test-only session date so this test's cache entries can never collide with a
  // real "today" key used elsewhere in the process.
  mock.module("../../../lib/providers/spx-session", {
    namedExports: {
      todayEtYmd: () => "2099-01-01",
    },
  });
  mock.module("./spx-desk-merge", {
    namedExports: {
      mergeDeskLayers: (desk: unknown) => desk,
    },
  });

  const { loadSpxDesk, loadSpxDeskPulse, loadSpxDeskFlow, loadMergedSpxDesk } =
    await import("./spx-desk-loader");

  const fromStandaloneDesk = await loadSpxDesk();
  const fromStandalonePulse = await loadSpxDeskPulse();
  const fromStandaloneFlow = await loadSpxDeskFlow();
  const merged = await loadMergedSpxDesk();

  assert.equal(
    deskCount,
    1,
    "buildSpxDesk ran more than once — loadSpxDesk() and loadMergedSpxDesk() are using different cache keys again"
  );
  assert.equal(
    pulseCount,
    1,
    "buildSpxDeskPulse ran more than once — pulse cache key mismatch between standalone route and loader"
  );
  assert.equal(
    flowCount,
    1,
    "buildSpxDeskFlow ran more than once — flow cache key mismatch between standalone route and loader"
  );
  assert.deepEqual(fromStandaloneDesk, merged.desk);
  assert.deepEqual(fromStandalonePulse, merged.pulse);
  assert.deepEqual(fromStandaloneFlow, merged.flow);

  mock.restoreAll();
});
