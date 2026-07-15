import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PR-N4 source contracts (same readFileSync idiom as db.test.ts / play-status-contract):
// the load-bearing SQL/wiring properties that a refactor could silently drop —
//  1. publish_context and morning_verdict are COALESCE first-write-wins (the pin is
//     evidence of the ORIGINAL publish/9:15 read; a rebuild/re-run must not rewrite it);
//  2. the pulled latch is one-way in SQL (pulled OR …), the same no-flapping discipline
//     as the 0DTE status latch;
//  3. the schema adds are idempotent ALTER … IF NOT EXISTS (prod picks them up on boot);
//  4. the sync path threads publish_context; the edition read path applies the pull
//     overlay on EVERY serve branch; the cron persists verdicts alongside Redis.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("db.ts: publish_context pins first-write-wins in the outcomes upsert", () => {
  const src = read("src/lib/db.ts");
  assert.match(
    src,
    /publish_context = COALESCE\(nighthawk_play_outcomes\.publish_context, EXCLUDED\.publish_context\)/,
    "the upsert's DO UPDATE must COALESCE the existing pin first — a force-rebuild can never overwrite the original publish evidence"
  );
});

test("db.ts: morning_verdict is COALESCE-pinned and the pulled latch is one-way (pulled OR)", () => {
  const src = read("src/lib/db.ts");
  const fn = src.slice(
    src.indexOf("export async function recordNighthawkMorningVerdict"),
    src.indexOf("export type NighthawkPulledPlay")
  );
  assert.match(
    fn,
    /morning_verdict = COALESCE\(o\.morning_verdict, \$3::jsonb\)/,
    "the FIRST verdict of the session is the calibration datum — re-runs must not rewrite it"
  );
  assert.match(
    fn,
    /pulled = o\.pulled OR \$4::boolean/,
    "pulled-is-pulled: a softer re-run verdict can never un-pull (0DTE latch discipline)"
  );
  assert.match(fn, /pulled_at = CASE WHEN \$4::boolean THEN COALESCE\(o\.pulled_at, NOW\(\)\)/);
});

test("db.ts: PR-N4 columns are idempotent additive ALTERs on nighthawk_play_outcomes", () => {
  const src = read("src/lib/db.ts");
  for (const col of ["publish_context JSONB", "morning_verdict JSONB", "pulled BOOLEAN NOT NULL DEFAULT FALSE", "pulled_reason TEXT", "pulled_at TIMESTAMPTZ"]) {
    assert.ok(
      src.includes(`ALTER TABLE nighthawk_play_outcomes ADD COLUMN IF NOT EXISTS ${col}`),
      `missing idempotent ALTER for: ${col}`
    );
  }
});

test("sync path threads the pin: syncNighthawkPlayOutcomes → upsert rows carry publish_context", () => {
  const src = read("src/features/nighthawk/lib/play-outcomes.ts");
  const sync = src.slice(src.indexOf("export async function syncNighthawkPlayOutcomes"));
  assert.match(sync, /publishContexts: Record<string, Record<string, unknown> \| null> = \{\}/,
    "the pin map must stay OPTIONAL — pinning is evidence, never a sync dependency");
  assert.match(sync, /publish_context: publishContexts\[ticker\] \?\? null/);
});

test("edition builder pins from the SAME in-memory build context it publishes from", () => {
  const src = read("src/features/nighthawk/lib/edition-builder.ts");
  assert.match(src, /buildNighthawkPublishContexts\(\{/);
  assert.match(
    src,
    /syncNighthawkPlayOutcomes\(editionFor, finalPlays, sectorByTicker, publishContexts\)/,
    "the pin must ride the existing outcome sync — no second write path"
  );
});

test("edition read path: EVERY serve branch passes through the pull overlay", () => {
  const src = read("src/app/api/market/nighthawk/edition/route.ts");
  assert.match(src, /async function withPullOverlay/);
  // carry-until-close, exact-date, and latest-fallback branches all stamp the latch.
  const overlayCalls = src.match(/await withPullOverlay\(/g) ?? [];
  assert.ok(
    overlayCalls.length >= 3,
    `expected the overlay on all 3 DB-served branches (carry/exact/latest), found ${overlayCalls.length}`
  );
  // Fail-soft: an overlay read failure must degrade to serving unstamped, never a 500.
  const helper = src.slice(src.indexOf("async function withPullOverlay"), src.indexOf("export async function GET"));
  assert.match(helper, /catch/);
  assert.match(helper, /return edition;/);
});

test("morning-confirm cron: verdicts persist durably ALONGSIDE the Redis badge (which stays)", () => {
  const src = read("src/app/api/cron/nighthawk-morning-confirm/route.ts");
  assert.match(src, /persistNighthawkMorningVerdicts\(\{/);
  // The Redis blob write survives — the UI badge layer reads it today.
  assert.match(src, /redis\.set\(REDIS_KEY\(editionFor\), JSON\.stringify\(result\), "EX", REDIS_TTL_S\)/);
  // Persistence outcome is reported in the cron payload (observable, not swallowed).
  assert.match(src, /verdicts_persisted: verdictPersist\.persisted/);
  assert.match(src, /plays_pulled: verdictPersist\.pulled/);
});

test("headline-record exclusion stays in lockstep across both scoreable filters", () => {
  const analytics = read("src/features/nighthawk/lib/analytics.ts");
  assert.match(analytics, /r\.pulled !== true/);
  const trackRecord = read("src/lib/track-record-page.ts");
  const scoreable = trackRecord.slice(
    trackRecord.indexOf("export function isNighthawkOutcomeScoreable"),
    trackRecord.indexOf("function nhEntryMid")
  );
  assert.match(scoreable, /r\.pulled !== true/);
});
