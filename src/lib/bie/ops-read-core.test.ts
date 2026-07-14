import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isOpsReadQuestion,
  parseOpsReadKind,
  evaluateCronRuns,
  evaluateProviderHealth,
  evaluateCacheProbe,
  combineOpsHealth,
  renderCronRuns,
  renderProviderHealth,
  renderCacheProbe,
  renderOpsOverview,
  type CronRunInput,
  type CronRunsGathered,
  type ProviderProbeInput,
  type CacheProbeInput,
} from "./ops-read-core";

// ---------------------------------------------------------------------------
// Query parsing / routing
// ---------------------------------------------------------------------------

describe("ops-read-core: query classification", () => {
  test("cron-health phrasings route to crons", () => {
    for (const q of [
      "are the crons healthy",
      "cron status",
      "cron health",
      "are the scheduled jobs running",
      "any crons stale?",
      "are background jobs behind",
    ]) {
      assert.equal(isOpsReadQuestion(q), true, q);
      assert.equal(parseOpsReadKind(q), "crons", q);
    }
  });

  test("provider phrasings route to providers", () => {
    for (const q of ["is UW up", "is polygon down", "is unusual whales up", "provider health", "is the data provider reachable"]) {
      assert.equal(isOpsReadQuestion(q), true, q);
      assert.equal(parseOpsReadKind(q), "providers", q);
    }
  });

  test("freshness phrasings route to caches", () => {
    for (const q of ["is the data fresh", "are the caches stale", "how fresh is the data", "is the snapshot current"]) {
      assert.equal(isOpsReadQuestion(q), true, q);
      assert.equal(parseOpsReadKind(q), "caches", q);
    }
  });

  test("overview phrasings + multi-category route to overview", () => {
    for (const q of ["ops status", "ops health", "health check", "is everything healthy", "are all systems up"]) {
      assert.equal(parseOpsReadKind(q), "overview", q);
    }
    // Multi-category → overview.
    assert.equal(parseOpsReadKind("are the crons healthy and is UW up"), "overview");
  });

  test("does NOT steal the diagnostic surface-forming class (router regression guard)", () => {
    // These belong to system_diagnostic — must NOT be classified as ops reads.
    assert.equal(isOpsReadQuestion("is the flow pipeline healthy"), false);
    assert.equal(isOpsReadQuestion("what's failing right now"), false);
    assert.equal(isOpsReadQuestion("why isn't NVDA GEX forming"), false);
    // A plain market/definition question is not an ops read.
    assert.equal(isOpsReadQuestion("what is the gamma flip"), false);
    assert.equal(isOpsReadQuestion("what's the SPX setup right now"), false);
    // A provider named WITHOUT a status cue is not an ops read.
    assert.equal(isOpsReadQuestion("what is the polygon gamma flip"), false);
  });
});

// ---------------------------------------------------------------------------
// cron_runs
// ---------------------------------------------------------------------------

function cron(o: Partial<CronRunInput>): CronRunInput {
  return {
    key: "k",
    name: "Job",
    schedule_label: "Every 5 min",
    status: "healthy",
    last_run_at: "2026-07-14T13:00:00Z",
    last_status: "ok",
    age_min: 3,
    stale_after_min: 15,
    market_hours_stale: false,
    last_message: "ok",
    ...o,
  };
}

function gathered(jobs: CronRunInput[], extra: Partial<CronRunsGathered> = {}): CronRunsGathered {
  return { jobs, db_configured: true, logged_runs_total: 100, diagnostics_note: null, snapshot_available: true, ...extra };
}

describe("ops-read-core: evaluateCronRuns", () => {
  test("all healthy → overall healthy", () => {
    const r = evaluateCronRuns(gathered([cron({ key: "a" }), cron({ key: "b" })]));
    assert.equal(r.overall, "healthy");
    assert.equal(r.total, 2);
    assert.equal(r.healthy, 2);
  });

  test("a failed cron pulls overall to down and is flagged", () => {
    const r = evaluateCronRuns(gathered([cron({ key: "ok" }), cron({ key: "bad", status: "failed", last_status: "failed", last_message: "UW timeout" })]));
    assert.equal(r.overall, "down");
    assert.equal(r.failed, 1);
    const bad = r.jobs.find((j) => j.key === "bad")!;
    assert.equal(bad.failed, true);
    assert.equal(bad.status, "down");
  });

  test("a stale cron → degraded", () => {
    const r = evaluateCronRuns(gathered([cron({ status: "stale", age_min: 40 })]));
    assert.equal(r.overall, "degraded");
    assert.equal(r.stale, 1);
    assert.equal(r.jobs[0].stale, true);
  });

  test("market_hours_stale is treated as stale even if base status is not", () => {
    const r = evaluateCronRuns(gathered([cron({ status: "healthy", market_hours_stale: true })]));
    assert.equal(r.jobs[0].stale, true);
    assert.equal(r.overall, "degraded");
  });

  test("a never-ran cron is reported honestly, no fabricated timestamp", () => {
    const r = evaluateCronRuns(gathered([cron({ status: "unknown", last_run_at: null, last_status: null, age_min: null })]));
    assert.equal(r.never_ran, 1);
    const j = r.jobs[0];
    assert.equal(j.never_ran, true);
    assert.equal(j.last_run_at, null);
    assert.equal(j.age_min, null);
    // The rendered admin line never invents a time.
    const md = renderCronRuns(r, "admin");
    assert.match(md, /no recorded run/);
  });

  test("no logged runs surfaces the honest diagnostics note", () => {
    const r = evaluateCronRuns(gathered([cron({})], { logged_runs_total: 0, diagnostics_note: "CRON_SECRET is not set." }));
    assert.equal(r.note, "CRON_SECRET is not set.");
  });

  test("unavailable snapshot → unknown, not a fabricated healthy", () => {
    const r = evaluateCronRuns({ jobs: [], db_configured: false, logged_runs_total: 0, diagnostics_note: null, snapshot_available: false });
    assert.equal(r.available, false);
    assert.equal(r.overall, "unknown");
    assert.match(renderCronRuns(r, "admin"), /unavailable/i);
  });

  test("the expected line states cadence + overdue window, not a next-run time", () => {
    const r = evaluateCronRuns(gathered([cron({ schedule_label: "Every 5 min", stale_after_min: 15 })]));
    assert.equal(r.jobs[0].expected, "Every 5 min — overdue if no run in 15m");
  });
});

// ---------------------------------------------------------------------------
// provider-health
// ---------------------------------------------------------------------------

function probe(o: Partial<ProviderProbeInput>): ProviderProbeInput {
  return { provider: "polygon", label: "Polygon", configured: true, responded: true, httpStatus: 200, latencyMs: 50, ...o };
}

describe("ops-read-core: evaluateProviderHealth", () => {
  test("both up → healthy", () => {
    const r = evaluateProviderHealth([probe({}), probe({ provider: "uw", label: "Unusual Whales", latencyMs: 120 })]);
    assert.equal(r.overall, "healthy");
    assert.equal(r.providers.every((p) => p.status === "up"), true);
  });

  test("one down, one up → degraded", () => {
    const r = evaluateProviderHealth([probe({}), probe({ provider: "uw", responded: false, httpStatus: null, latencyMs: null })]);
    assert.equal(r.overall, "degraded");
    assert.equal(r.providers.find((p) => p.provider === "uw")!.status, "down");
  });

  test("all down → down", () => {
    const r = evaluateProviderHealth([probe({ responded: false, httpStatus: null, latencyMs: null })]);
    assert.equal(r.overall, "down");
  });

  test("unconfigured provider is excluded from the verdict", () => {
    const r = evaluateProviderHealth([probe({}), probe({ provider: "uw", configured: false, responded: false, httpStatus: null, latencyMs: null })]);
    assert.equal(r.overall, "healthy");
    assert.equal(r.providers.find((p) => p.provider === "uw")!.status, "unconfigured");
  });

  test("http status → clean status derivation", () => {
    assert.equal(evaluateProviderHealth([probe({ httpStatus: 401 })]).providers[0].status, "down");
    assert.equal(evaluateProviderHealth([probe({ httpStatus: 500 })]).providers[0].status, "down");
    assert.equal(evaluateProviderHealth([probe({ httpStatus: 429 })]).providers[0].status, "up");
    assert.equal(evaluateProviderHealth([probe({ httpStatus: 404 })]).providers[0].status, "up"); // reachable
  });

  test("no configured providers → unknown", () => {
    const r = evaluateProviderHealth([probe({ configured: false, responded: false, httpStatus: null })]);
    assert.equal(r.overall, "unknown");
  });

  test("rendered detail never leaks a key/hostname", () => {
    const md = renderProviderHealth(evaluateProviderHealth([probe({}), probe({ provider: "uw", label: "Unusual Whales" })]), "admin");
    assert.doesNotMatch(md, /apiKey|api_key|Bearer|https?:\/\/|\.com|UW_API_KEY|POLYGON_API_KEY/i);
  });
});

// ---------------------------------------------------------------------------
// cache-probe
// ---------------------------------------------------------------------------

function cache(o: Partial<CacheProbeInput>): CacheProbeInput {
  return {
    label: "Snapshot",
    key: "bie:full-state",
    present: true,
    ageSec: 60,
    remainingTtlSec: 800,
    ttlSec: 900,
    staleAfterSec: 720,
    marketHoursOnly: true,
    ...o,
  };
}

describe("ops-read-core: evaluateCacheProbe", () => {
  test("fresh cache (RTH) → healthy", () => {
    const r = evaluateCacheProbe([cache({ ageSec: 60 })], true);
    assert.equal(r.overall, "healthy");
    assert.equal(r.caches[0].status, "healthy");
  });

  test("stale cache during RTH → degraded", () => {
    const r = evaluateCacheProbe([cache({ ageSec: 5000 })], true);
    assert.equal(r.overall, "degraded");
    assert.match(r.caches[0].detail, /stale/);
  });

  test("stale market-hours cache OFF-hours → expected, not a fault", () => {
    const r = evaluateCacheProbe([cache({ ageSec: 5000 })], false);
    assert.equal(r.caches[0].status, "healthy");
    assert.match(r.caches[0].detail, /market closed/);
  });

  test("missing market-hours cache off-hours → expected (unknown), not degraded", () => {
    const r = evaluateCacheProbe([cache({ present: false, ageSec: null })], false);
    assert.equal(r.caches[0].status, "unknown");
    assert.match(r.caches[0].detail, /market closed/);
  });

  test("missing cache during RTH → degraded (real gap)", () => {
    const r = evaluateCacheProbe([cache({ present: false, ageSec: null })], true);
    assert.equal(r.caches[0].status, "degraded");
    assert.match(r.caches[0].detail, /missing/);
  });

  test("present but no timestamp → healthy with honest 'age unknown'", () => {
    const r = evaluateCacheProbe([cache({ ageSec: null })], true);
    assert.equal(r.caches[0].status, "healthy");
    assert.match(r.caches[0].detail, /age unknown/);
  });
});

// ---------------------------------------------------------------------------
// combine + rendering (member vs admin)
// ---------------------------------------------------------------------------

describe("ops-read-core: combine + audience rendering", () => {
  test("combineOpsHealth is worst-of", () => {
    assert.equal(combineOpsHealth(["healthy", "healthy"]), "healthy");
    assert.equal(combineOpsHealth(["healthy", "degraded"]), "degraded");
    assert.equal(combineOpsHealth(["degraded", "down"]), "down");
    assert.equal(combineOpsHealth(["healthy", "unknown"]), "unknown");
    assert.equal(combineOpsHealth([undefined, undefined]), "unknown");
  });

  test("member audience gets a clean badge with NO internal detail", () => {
    const r = evaluateCronRuns(gathered([cron({ key: "flow-ingest", status: "failed", last_status: "failed", last_message: "UW timeout" })]));
    const memberMd = renderCronRuns(r, "member");
    // No cron key, no cron name, no raw message.
    assert.doesNotMatch(memberMd, /flow-ingest|UW timeout|`/);
    assert.match(memberMd, /trouble|delayed|alerted/i);

    const adminMd = renderCronRuns(r, "admin");
    assert.match(adminMd, /flow-ingest/);
    assert.match(adminMd, /UW timeout/);
  });

  test("member badge reflects overall health wording", () => {
    const healthy = evaluateCronRuns(gathered([cron({})]));
    assert.match(renderCronRuns(healthy, "member"), /operating normally/i);
  });

  test("overview admin render includes all three sections", () => {
    const crons = evaluateCronRuns(gathered([cron({})]));
    const providers = evaluateProviderHealth([probe({})]);
    const caches = evaluateCacheProbe([cache({})], true);
    const md = renderOpsOverview(
      { overall: combineOpsHealth([crons.overall, providers.overall, caches.overall]), crons, providers, caches },
      "admin"
    );
    assert.match(md, /Cron health/);
    assert.match(md, /Provider reachability/);
    assert.match(md, /Cache freshness/);
  });

  test("overview member render is the single clean badge only", () => {
    const crons = evaluateCronRuns(gathered([cron({})]));
    const md = renderOpsOverview({ overall: "healthy", crons, providers: null, caches: null }, "member");
    assert.doesNotMatch(md, /Cron health|Provider|Cache/);
    assert.match(md, /operating normally/i);
  });

  test("cache admin render never exposes the internal Redis key", () => {
    const md = renderCacheProbe(evaluateCacheProbe([cache({ key: "bie:full-state", label: "24/7 platform snapshot" })], true), "admin");
    assert.doesNotMatch(md, /bie:full-state|vector:universe/);
    assert.match(md, /24\/7 platform snapshot/);
  });
});
