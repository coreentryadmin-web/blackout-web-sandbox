import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// edition-builder.ts's import graph transitively pulls in
// src/lib/providers/gex-positioning.ts (via ./dossier -> the same positioning fetch
// get_positioning uses), which has `import "server-only"` at its top — that marker
// package throws outside Next's "react-server" webpack export condition, so a plain
// `node --test` load crashes at import time unless it's stubbed, same as every
// run-tool.test.ts / spx-signal-log-*.test.ts sibling in this repo does.
mock.module("server-only", { namedExports: {} });

// Task #129: nighthawk_dossiers_staging is a SCRATCH table — scoreCandidate()'s full
// per-candidate breakdown lives there only until clearNighthawkStaging() deletes it,
// which used to happen with nothing durable written first. archiveAndClearNighthawkStaging
// (edition-builder.ts) is the fix: every former direct clearNighthawkStaging() call site
// now routes through this wrapper, which archives the CURRENT staging rows into
// nighthawk_scoring_history immediately before deleting them. This suite proves that
// ordering directly against the exported wrapper (the real pipeline's own call sites all
// invoke this one function — see the 4 `await archiveAndClearNighthawkStaging(editionFor)`
// sites in edition-builder.ts), the same "test the write function directly" fallback task
// #108's own precedent used for a from-scratch-integration-test-unfriendly pipeline
// (spx-signal-log-engine-snapshot.test.ts's header comment documents the same call).
const state = {
  calls: [] as Array<{ fn: "archive"; editionFor: string } | { fn: "clear"; editionFor: string }>,
  archiveImpl: async (editionFor: string): Promise<number> => {
    state.calls.push({ fn: "archive", editionFor });
    return 2;
  },
};

function resetState() {
  state.calls = [];
  state.archiveImpl = async (editionFor: string) => {
    state.calls.push({ fn: "archive", editionFor });
    return 2;
  };
}

// edition-builder.ts statically imports 11 names from "@/lib/db" (dbConfigured,
// fetchNighthawkEditionByDate, fetchNighthawkJob, fetchStagedDossierTickers,
// fetchStagedDossiers, logNighthawkJob, saveDossierStaging, upsertNighthawkJob,
// upsertNighthawkEdition, failStaleNighthawkJobs) besides the two this suite drives —
// mock.module's namedExports FULLY REPLACES the module (no merge with the real one), so
// the real module must be imported first and spread, overriding only archiveNighthawkStaging
// / clearNighthawkStaging (same idiom run-tool.test.ts uses for this exact file).
before(async () => {
  const realDb = await import("../db");
  mock.module("../db", {
    namedExports: {
      ...realDb,
      archiveNighthawkStaging: async (editionFor: string) => state.archiveImpl(editionFor),
      clearNighthawkStaging: async (editionFor: string) => {
        state.calls.push({ fn: "clear", editionFor });
      },
    },
  });
});

// Lazy import (ESM caches the module under test after the first call) so the mocks above
// are in place before edition-builder.ts's own top-level imports resolve.
const mod = () => import("./edition-builder");

test("archiveAndClearNighthawkStaging: archives BEFORE clearing — the real pipeline order every call site relies on", async () => {
  const { archiveAndClearNighthawkStaging } = await mod();
  resetState();

  await archiveAndClearNighthawkStaging("2026-07-06");

  assert.deepEqual(state.calls, [
    { fn: "archive", editionFor: "2026-07-06" },
    { fn: "clear", editionFor: "2026-07-06" },
  ]);
});

test("archiveAndClearNighthawkStaging: same edition_for is threaded to both the archive and the clear", async () => {
  const { archiveAndClearNighthawkStaging } = await mod();
  resetState();

  await archiveAndClearNighthawkStaging("2026-08-11");

  assert.equal(state.calls[0].editionFor, "2026-08-11");
  assert.equal(state.calls[1].editionFor, "2026-08-11");
});

test("archiveAndClearNighthawkStaging: an archive failure is swallowed — staging still clears (never blocks publish/resume)", async () => {
  const { archiveAndClearNighthawkStaging } = await mod();
  resetState();
  state.archiveImpl = async () => {
    throw new Error("transient DB error");
  };

  // Must not throw — a stuck staging table would break the NEXT run's checkpoint-resume
  // logic (fetchStagedDossierTickers gating `remaining`), which is worse than losing one
  // night's post-hoc queryability.
  await assert.doesNotReject(() => archiveAndClearNighthawkStaging("2026-07-06"));

  assert.deepEqual(
    state.calls.map((c) => c.fn),
    ["clear"],
    "clear must still run even though the archive call threw"
  );
});

test("archiveAndClearNighthawkStaging: an empty staging table (0 rows archived) still clears cleanly", async () => {
  const { archiveAndClearNighthawkStaging } = await mod();
  resetState();
  state.archiveImpl = async (editionFor: string) => {
    state.calls.push({ fn: "archive", editionFor });
    return 0;
  };

  await archiveAndClearNighthawkStaging("2026-07-06");

  assert.deepEqual(
    state.calls.map((c) => c.fn),
    ["archive", "clear"]
  );
});
