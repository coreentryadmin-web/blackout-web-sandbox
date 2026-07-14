// Shared test scaffolding for the Cortex suites. Lives in a plain .ts file (not a
// .test.ts) so the helper — and every fixture built through it — is type-checked by
// `npx tsc --noEmit` (tsconfig excludes **/*.test.ts; same rationale as
// fixtures-2026-07-13.ts / src/lib/bie/spx-full-state-fixture.ts).

import type { CortexInputs } from "./types";

/** A deterministic mid-session clock for tests: 2026-07-13 11:00 ET (15:00 UTC). */
export const TEST_NOW = "2026-07-13T15:00:00.000Z";

/** An all-null snapshot (every source absent) to override per test. */
export function baseInputs(over: Partial<CortexInputs> = {}): CortexInputs {
  return {
    ticker: "TEST",
    direction: "long",
    now: TEST_NOW,
    spot: null,
    expectedMovePts: null,
    gex: null,
    wallTrend: null,
    flow: null,
    sector: null,
    news: null,
    vex: null,
    darkPool: null,
    opening: null,
    errors: {},
    ...over,
  };
}
