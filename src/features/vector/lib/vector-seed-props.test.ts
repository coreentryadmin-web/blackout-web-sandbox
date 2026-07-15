import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard (2026-07-13, member-directed desk consolidation): BOTH surfaces that render Vector
 * — the standalone /vector page and the SPX Slayer flagship dashboard — must build their SSR seed
 * through the ONE shared loader, loadVectorSeedProps. If either page re-implements any piece of
 * the seed pipeline inline (bars fetch, wall-scope priming, observed-rail merge, modeled-prefix
 * backfill, empty-case seeding), the two desks can drift apart — exactly the class of bug this
 * consolidation exists to prevent.
 */
test("both Vector surfaces load their seed via the shared loadVectorSeedProps helper", () => {
  const vectorPage = readFileSync(join(process.cwd(), "src/app/(site)/vector/page.tsx"), "utf8");
  const dashboardPage = readFileSync(join(process.cwd(), "src/app/(site)/dashboard/page.tsx"), "utf8");

  assert.match(vectorPage, /loadVectorSeedProps/);
  assert.match(dashboardPage, /loadVectorSeedProps/);

  // The seed pipeline internals must live ONLY in the helper — neither page may call them inline.
  const pipelineInternals = [
    "fetchVectorSeedBars",
    "primeVectorWallScope",
    "mergeWallHistory",
    "backfillRailPrefix",
    "reconstructSessionRail",
    "seedWallHistoryForDisplay",
    "loadSessionWallHistory",
  ];
  for (const token of pipelineInternals) {
    assert.equal(
      vectorPage.includes(token),
      false,
      `/vector page must not inline seed internals (${token}) — use loadVectorSeedProps`
    );
    assert.equal(
      dashboardPage.includes(token),
      false,
      `/dashboard page must not inline seed internals (${token}) — use loadVectorSeedProps`
    );
  }

  // And the helper itself must still contain the full pipeline.
  const helper = readFileSync(
    join(process.cwd(), "src/features/vector/lib/vector-seed-props.ts"),
    "utf8"
  );
  for (const token of pipelineInternals) {
    assert.match(helper, new RegExp(token), `loadVectorSeedProps must own ${token}`);
  }
});
