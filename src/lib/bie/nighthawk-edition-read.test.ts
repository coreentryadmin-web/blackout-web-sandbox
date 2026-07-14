// BIE × Night Hawk edition bridge tests (PR-N9) — hermetic. The IO seams (the db
// edition/outcome readers, the session date helper) are mocked with mock.module
// BEFORE the module under test is loaded; nighthawk-edition-read.ts's own dynamic
// imports use RELATIVE specifiers, so the same relative specifiers registered here
// (this file lives in the same directory) resolve to the same URLs and intercept.
//
// Honesty contract under test: pinned blobs render EXACTLY what was recorded (signed
// band geometry, verdict numbers, pulled reason), pre-#331 rows say "no decision
// context on record" and reconstruct NOTHING, pulled plays carry the documented
// both-directions exclusion note, and empty/miss/outage states are explicit — never
// a fabricated edition.

import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkEditionRow } from "@/lib/db";

// ── Mutable mock state (reset per test) ─────────────────────────────────────────────

let dbIsConfigured = true;
let editionByDate: NighthawkEditionRow | null = null;
let editionByDateCalls: string[] = [];
let latestPlayable: NighthawkEditionRow | null = null;
let latestAny: NighthawkEditionRow | null = null;
let queryRows: Array<Record<string, unknown>> = [];
let queryCalls: Array<{ sql: string; params: unknown[] }> = [];
let queryError: Error | null = null;
let today = "2026-07-14";

mock.module("../db", {
  namedExports: {
    dbConfigured: () => dbIsConfigured,
    fetchNighthawkEditionByDate: async (d: string) => {
      editionByDateCalls.push(d);
      return editionByDate;
    },
    fetchLatestPlayableNighthawkEdition: async () => latestPlayable,
    fetchLatestNighthawkEdition: async () => latestAny,
    dbQuery: async (sql: string, params: unknown[]) => {
      queryCalls.push({ sql, params });
      if (queryError) throw queryError;
      return { rows: queryRows };
    },
  },
});

mock.module("../../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => today,
  },
});

let mod: typeof import("./nighthawk-edition-read");
before(async () => {
  mod = await import("./nighthawk-edition-read");
});

beforeEach(() => {
  dbIsConfigured = true;
  editionByDate = null;
  editionByDateCalls = [];
  latestPlayable = null;
  latestAny = null;
  queryRows = [];
  queryCalls = [];
  queryError = null;
  today = "2026-07-14";
});

// ── Fixtures (the post-#331 shapes: publish-context.ts / morning-verdict-persist.ts) ─

/** A real publish_context pin as buildNighthawkPublishContext writes it. */
const PIN = {
  context_version: 1,
  pinned_at: "2026-07-13T23:45:00Z",
  direction: "LONG",
  conviction: "B",
  score: 62,
  entry_premium: 1.8,
  spot_at_publish: 34.12,
  prior_close: 33.9,
  atr14: 0.82,
  entry_range_low: 33.8,
  entry_range_high: 34.1,
  target: 35.4,
  stop: 33.2,
  band_distance_pct: -0.0586,
  target_distance_pct: 3.7514,
  stop_distance_pct: -2.6964,
  market: {
    composite_regime: "risk-on",
    tide_bias: "bullish",
    vix_iv_rank: 22,
    vix_close: 16.4,
    spx_close: 7511.2,
    breadth: { pct_advancing: 61.3, advance_decline_ratio: 1.62, pct_above_vwap: 58.9 },
  },
  catalysts: { earnings_tomorrow: false, earnings_date: null, earnings_risk: false, catalyst_flags: ["flow_streak"] },
  confluence: { flow_score: 18.5, tech_score: 12 },
};

/** A detached-band pin — the N-3 signature (LONG band far below the market). */
const DETACHED_PIN = {
  ...PIN,
  spot_at_publish: 417.0,
  entry_range_low: 226.82,
  entry_range_high: 227.27,
  target: 469.47,
  stop: 220.0,
  band_distance_pct: -45.4988,
  target_distance_pct: 12.5827,
  stop_distance_pct: -47.2422,
};

/** A persisted morning verdict as buildMorningVerdictRecord writes it. */
const VERDICT_INVALIDATED = {
  verdict_version: 1,
  status: "INVALIDATED",
  reason: "gapped -6.55% through the published stop pre-market",
  checked_at: "2026-07-14T13:15:00Z",
  metrics: {
    stock_premarket: 31.9,
    spx_premarket: 7490.0,
    spx_prior_close: 7511.2,
    overnight_gap_pts: -21.2,
    overnight_gap_pct: -0.2822,
    regime: "risk-off",
    entry_range_low: 33.8,
    entry_range_high: 34.1,
    target: 35.4,
    stop: 33.2,
    premarket_vs_stop_pct: -3.9157,
    premarket_vs_band_pct: -6.4516,
  },
};

const VERDICT_CONFIRMED = {
  ...VERDICT_INVALIDATED,
  status: "CONFIRMED",
  reason: "pre-market inside the entry band; no adverse gap",
};

function outcomeRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    edition_for: "2026-07-14",
    ticker: "CSX",
    direction: "LONG",
    conviction: "B",
    score: 62,
    entry_range_low: 33.8,
    entry_range_high: 34.1,
    target: 35.4,
    stop: 33.2,
    next_day_open: null,
    next_day_close: null,
    session_high: null,
    session_low: null,
    hit_target: false,
    hit_stop: false,
    outcome: "pending",
    pulled: false,
    pulled_reason: null,
    pulled_at: null,
    publish_context: PIN,
    morning_verdict: null,
    ...over,
  };
}

function editionRow(over: Partial<NighthawkEditionRow> = {}): NighthawkEditionRow {
  return {
    edition_for: "2026-07-14",
    session_date: "2026-07-13",
    published_at: "2026-07-13T23:46:00Z",
    recap_headline: "Tape closed firm into the overnight",
    recap_summary: "Breadth held; five plays survived the funnel.",
    market_recap: {},
    plays: [
      {
        rank: 1,
        ticker: "CSX",
        direction: "LONG",
        conviction: "B",
        play_type: "stock",
        thesis: "Rail volumes inflecting with a 3-day flow streak.",
        key_signal: "3 consecutive days of call accumulation",
        entry_range: "33.80-34.10",
        target: "35.40",
        stop: "33.20",
        options_play: "Aug 35c",
        score: 62,
      },
      {
        rank: 2,
        ticker: "AMD",
        direction: "SHORT",
        conviction: "C",
        play_type: "stock",
        thesis: "Fading the earnings pop.",
        key_signal: "put wall overhead",
        entry_range: "150.00-151.00",
        target: "144.00",
        stop: "154.00",
        options_play: "weekly 145p",
        score: 48,
      },
    ],
    meta: {},
    ...over,
  };
}

// ── Structural readers ───────────────────────────────────────────────────────────────

test("readNighthawkPublishPin: a real pin round-trips every rendered field", () => {
  const pin = mod.readNighthawkPublishPin(PIN);
  assert.ok(pin);
  assert.equal(pin!.pinned_at, "2026-07-13T23:45:00Z");
  assert.equal(pin!.direction, "LONG");
  assert.equal(pin!.spot_at_publish, 34.12);
  assert.equal(pin!.band_distance_pct, -0.0586);
  assert.equal(pin!.market.composite_regime, "risk-on");
  assert.equal(pin!.market.breadth?.pct_advancing, 61.3);
  assert.equal(pin!.catalysts.earnings_tomorrow, false);
  assert.deepEqual(pin!.catalysts.catalyst_flags, ["flow_streak"]);
  assert.equal(pin!.confluence?.flow_score, 18.5);
});

test("readNighthawkPublishPin: null / non-object / unversioned blobs read as NO pin — never a guess", () => {
  assert.equal(mod.readNighthawkPublishPin(null), null);
  assert.equal(mod.readNighthawkPublishPin("garbage"), null);
  assert.equal(mod.readNighthawkPublishPin([1, 2]), null);
  // No context_version stamp → not a pin we understand.
  assert.equal(mod.readNighthawkPublishPin({ spot_at_publish: 34.12 }), null);
});

test("readNighthawkPublishPin: malformed fields degrade to null values, not invented ones", () => {
  const pin = mod.readNighthawkPublishPin({ context_version: 1, spot_at_publish: "not-a-number", market: "nope" });
  assert.ok(pin);
  assert.equal(pin!.spot_at_publish, null);
  assert.equal(pin!.market.composite_regime, null);
  assert.equal(pin!.market.breadth, null);
});

test("readNighthawkMorningVerdict: a persisted verdict round-trips the numbers it saw", () => {
  const v = mod.readNighthawkMorningVerdict(VERDICT_INVALIDATED);
  assert.ok(v);
  assert.equal(v!.status, "INVALIDATED");
  assert.equal(v!.metrics?.stock_premarket, 31.9);
  assert.equal(v!.metrics?.overnight_gap_pts, -21.2);
  assert.equal(v!.metrics?.premarket_vs_stop_pct, -3.9157);
  assert.equal(v!.metrics?.premarket_vs_band_pct, -6.4516);
});

test("readNighthawkMorningVerdict: no status / non-object → null (no verdict on record)", () => {
  assert.equal(mod.readNighthawkMorningVerdict(null), null);
  assert.equal(mod.readNighthawkMorningVerdict({ metrics: {} }), null);
});

// ── Pure builders: the edition envelope ─────────────────────────────────────────────

test("buildNighthawkEditionEnvelope: post-#331 plays render pinned evidence — signed geometry, regime, breadth, catalysts, score snapshot", () => {
  const env = mod.buildNighthawkEditionEnvelope(editionRow(), [
    outcomeRow() as never,
    outcomeRow({ ticker: "AMD", direction: "SHORT", conviction: "C", score: 48, publish_context: { ...PIN, direction: "SHORT" } }) as never,
  ]);
  assert.equal(env.intent, "nighthawk_edition");
  assert.match(env.headline, /2026-07-14/);
  assert.match(env.headline, /2 ranked plays/);
  const md = env.markdown;
  // The pinned evidence block, with the SIGNED distances.
  assert.match(md, /spot 34\.12/);
  assert.match(md, /nearest fillable edge −?-?0\.06% from spot/);
  assert.match(md, /target 35\.4 \(\+3\.75%\)/);
  assert.match(md, /stop 33\.2 \(-2\.7%\)/);
  assert.match(md, /regime risk-on · tide bullish/);
  assert.match(md, /61\.3% advancing · A\/D ratio 1\.62/);
  assert.match(md, /earnings tomorrow no/);
  assert.match(md, /flags: flow_streak/);
  assert.match(md, /Score snapshot at publish: score 62/);
  assert.match(md, /flow score 18\.5/);
  // The edition's own published content is carried.
  assert.match(md, /Rail volumes inflecting/);
  assert.match(md, /entry 33\.80-34\.10 · target 35\.40 · stop 33\.20/);
  assert.equal(env.confidence.level, "high");
});

test("buildNighthawkEditionEnvelope: the detached-band signature is flagged in plain words — but ONLY past the N-3 threshold", () => {
  const env = mod.buildNighthawkEditionEnvelope(
    editionRow({ plays: [editionRow().plays[0]] }),
    [outcomeRow({ publish_context: DETACHED_PIN }) as never]
  );
  assert.match(env.markdown, /-45\.5% from spot/);
  assert.match(env.markdown, /the band sits BELOW the market — the detached-band signature/);
  // A few basis points of drift (spot a hair above the band top — normal geometry)
  // must NOT be dressed up as the failure signature.
  const normal = mod.buildNighthawkEditionEnvelope(
    editionRow({ plays: [editionRow().plays[0]] }),
    [outcomeRow() as never] // band_distance_pct -0.0586
  );
  assert.doesNotMatch(normal.markdown, /detached-band signature/);
});

test("buildNighthawkEditionEnvelope: a pulled play is labeled PULLED with its reason and the BOTH-directions exclusion note", () => {
  const env = mod.buildNighthawkEditionEnvelope(editionRow(), [
    outcomeRow({
      pulled: true,
      pulled_reason: "Pulled pre-open: gapped -6.55% through the published stop pre-market",
      pulled_at: "2026-07-14T13:15:30.000Z",
      morning_verdict: VERDICT_INVALIDATED,
    }) as never,
  ]);
  assert.match(env.headline, /1 PULLED/);
  const md = env.markdown;
  assert.match(md, /#1 CSX LONG · conviction B · PULLED/);
  assert.match(md, /PULLED pre-open at 2026-07-14T13:15:30\.000Z — Pulled pre-open: gapped -6\.55%/);
  assert.match(md, /BOTH directions — a pulled play that would have won adds no win/);
  // The persisted verdict's numbers render too.
  assert.match(md, /Morning check \(2026-07-14T13:15:00Z\): INVALIDATED/);
  assert.match(md, /pre-market 31\.9/);
  assert.match(md, /SPX gap -21\.2 pts \(-0\.28%\)/);
  assert.match(md, /pre-market vs stop -3\.92% · vs band -6\.45%/);
});

test("buildNighthawkEditionEnvelope: pre-#331 rows say 'no decision context on record' — nothing reconstructed", () => {
  const env = mod.buildNighthawkEditionEnvelope(
    editionRow({ plays: [editionRow().plays[0]] }),
    [outcomeRow({ publish_context: null }) as never]
  );
  const md = env.markdown;
  assert.match(md, /Published before evidence pinning — no decision context on record/);
  // No fabricated evidence block.
  assert.doesNotMatch(md, /Tape at publish/);
  assert.ok(env.unavailableSources?.some((u) => u.source.includes("CSX")));
  assert.equal(env.confidence.level, "moderate");
});

test("buildNighthawkEditionEnvelope: a play with NO outcome row is noted honestly", () => {
  const env = mod.buildNighthawkEditionEnvelope(editionRow({ plays: [editionRow().plays[0]] }), []);
  assert.match(env.markdown, /No outcome row on record for this play/);
});

test("buildNighthawkEditionEnvelope: graded rows carry the grade + methodology (unfilled explains fillability)", () => {
  const env = mod.buildNighthawkEditionEnvelope(editionRow(), [
    outcomeRow({
      outcome: "target",
      hit_target: true,
      next_day_open: 34.0,
      next_day_close: 35.6,
      session_high: 35.7,
      session_low: 33.9,
    }) as never,
    outcomeRow({
      ticker: "AMD",
      direction: "SHORT",
      outcome: "unfilled",
      next_day_open: 145.2,
      next_day_close: 143.0,
      session_high: 146.0,
      session_low: 142.5,
      entry_range_low: 150,
      entry_range_high: 151,
      publish_context: { ...PIN, direction: "SHORT" },
    }) as never,
  ]);
  const md = env.markdown;
  assert.match(md, /Graded TARGET — the session reached the published target/);
  assert.match(md, /realized vs entry mid \+4\.86%/); // (35.6 - 33.95)/33.95
  assert.match(md, /Graded UNFILLED — the session never traded back into the published entry band/);
  assert.match(md, /Excluded from win\/loss tallies/);
});

test("buildNighthawkEditionEnvelope: recap-only edition is an honest empty playbook", () => {
  const env = mod.buildNighthawkEditionEnvelope(editionRow({ plays: [] }), []);
  assert.match(env.headline, /recap-only edition, no ranked plays/);
  assert.match(env.markdown, /Tape closed firm into the overnight/);
  assert.match(env.markdown, /honest empty playbook/);
  assert.equal(env.confidence.level, "high");
});

// ── Pure builders: pick-why ─────────────────────────────────────────────────────────

test("buildNighthawkPickWhyEnvelope: full story — pinned WHY, morning numbers, pulled state, grade", () => {
  const row = outcomeRow({
    pulled: true,
    pulled_reason: "Pulled pre-open: gapped -6.55% through the published stop pre-market",
    pulled_at: "2026-07-14T13:15:30.000Z",
    morning_verdict: VERDICT_INVALIDATED,
    outcome: "stop",
    next_day_open: 31.9,
    next_day_close: 31.4,
    session_high: 32.2,
    session_low: 31.1,
  });
  const play = mod.parseEditionPlays(editionRow().plays)[0]!;
  const env = mod.buildNighthawkPickWhyEnvelope(row as never, play);
  assert.match(env.headline, /Why CSX was picked — Night Hawk 2026-07-14 edition/);
  assert.match(env.headline, /PULLED pre-open/);
  assert.match(env.headline, /graded stop/);
  const titles = env.sections.map((s) => s.title);
  assert.deepEqual(titles, [
    "Why it was picked (pinned at publish)",
    "What the morning check saw",
    "Pulled",
    "How it graded",
  ]);
  const md = env.markdown;
  assert.match(md, /Published thesis: Rail volumes inflecting/);
  assert.match(md, /first-write-wins/);
  assert.match(md, /spot 34\.12/);
  assert.match(md, /INVALIDATED — gapped -6\.55% through the published stop pre-market/);
  assert.match(md, /pre-market vs stop -3\.92%/);
  assert.match(md, /one-way/);
  assert.match(md, /counterfactual-only/);
  assert.match(md, /Graded STOP/);
  assert.equal(env.confidence.level, "high");
});

test("buildNighthawkPickWhyEnvelope: pre-#331 row — honest 'no decision context on record', moderate confidence, no reconstruction", () => {
  const env = mod.buildNighthawkPickWhyEnvelope(outcomeRow({ publish_context: null }) as never, null);
  const md = env.markdown;
  assert.match(md, /Published before evidence pinning — no decision context on record/);
  assert.doesNotMatch(md, /Tape at publish/);
  assert.match(md, /No morning verdict is on record/);
  assert.match(md, /Not graded yet/);
  assert.equal(env.confidence.level, "moderate");
  assert.equal(env.unavailableSources?.length, 2); // pin + verdict both surfaced
});

test("buildNighthawkPickWhyEnvelope: an active (not pulled) play renders no Pulled section", () => {
  const env = mod.buildNighthawkPickWhyEnvelope(
    outcomeRow({ morning_verdict: VERDICT_CONFIRMED }) as never,
    null
  );
  assert.ok(!env.sections.some((s) => s.title === "Pulled"));
  assert.match(env.markdown, /CONFIRMED — pre-market inside the entry band/);
});

test("buildNighthawkPickNotFoundEnvelope: honest miss, dated and undated", () => {
  const undated = mod.buildNighthawkPickNotFoundEnvelope("ZZZQ", null);
  assert.match(undated.headline, /never appeared in a published Night Hawk edition/);
  const dated = mod.buildNighthawkPickNotFoundEnvelope("ZZZQ", "2026-07-10");
  assert.match(dated.headline, /not in the 2026-07-10 Night Hawk edition/);
  assert.match(dated.markdown, /rejected before publish never reaches this ledger/);
});

test("gradeText: pending → null; every outcome code explains its methodology", () => {
  assert.equal(mod.gradeText(outcomeRow() as never), null);
  assert.match(
    mod.gradeText(outcomeRow({ outcome: "ambiguous", next_day_close: 34 }) as never)!,
    /never scored as a win/
  );
  assert.match(mod.gradeText(outcomeRow({ outcome: "open", next_day_close: 34.5 }) as never)!, /closed without hitting/);
});

// ── IO: readNighthawkEdition ────────────────────────────────────────────────────────

test("readNighthawkEdition: latest playable edition + its outcome rows; context counts pinned/pulled", async () => {
  latestPlayable = editionRow();
  queryRows = [
    outcomeRow(),
    outcomeRow({ ticker: "AMD", pulled: true, pulled_reason: "Pulled pre-open: gap", publish_context: null }),
  ];
  const composed = await mod.readNighthawkEdition();
  assert.match(composed.answer, /Night Hawk edition for 2026-07-14 — 2 ranked plays, 1 PULLED/);
  assert.deepEqual(composed.context, { mode: "edition", edition_for: "2026-07-14", plays: 2, pulled: 1, pinned: 1 });
  // One SELECT, scoped to the edition.
  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0]!.sql, /WHERE edition_for = \$1::date/);
  assert.deepEqual(queryCalls[0]!.params, ["2026-07-14"]);
});

test("readNighthawkEdition: explicit dateYmd reads that edition, not the latest", async () => {
  editionByDate = editionRow({ edition_for: "2026-07-10" });
  await mod.readNighthawkEdition("2026-07-10");
  assert.deepEqual(editionByDateCalls, ["2026-07-10"]);
});

test("readNighthawkEdition: no edition on record → honest empty envelope; store outage → honest unreadable envelope", async () => {
  const empty = await mod.readNighthawkEdition();
  assert.match(empty.answer, /No Night Hawk edition on record yet/);
  dbIsConfigured = false;
  const down = await mod.readNighthawkEdition();
  assert.match(down.answer, /unreadable this turn/);
  assert.match(down.answer, /no edition is being invented in its place/i);
});

test("readNighthawkEdition: an outcome-rows read failure still serves the edition (rows noted absent honestly)", async () => {
  latestPlayable = editionRow();
  queryError = new Error("boom");
  const composed = await mod.readNighthawkEdition();
  assert.match(composed.answer, /Night Hawk edition for 2026-07-14/);
  assert.match(composed.answer, /No outcome row on record/);
});

// ── IO: readNighthawkPickWhy / composeNighthawkEditionRead ──────────────────────────

test("readNighthawkPickWhy: most recent publish of the ticker is the record explained; edition thesis merged in", async () => {
  queryRows = [outcomeRow()];
  editionByDate = editionRow();
  const composed = await mod.readNighthawkPickWhy("csx");
  assert.match(composed.answer, /Why CSX was picked — Night Hawk 2026-07-14 edition/);
  assert.match(composed.answer, /Published thesis: Rail volumes inflecting/);
  assert.match(queryCalls[0]!.sql, /ORDER BY edition_for DESC/);
  assert.deepEqual(queryCalls[0]!.params, ["CSX"]);
  assert.deepEqual(editionByDateCalls, ["2026-07-14"]);
  const ctx = composed.context as Record<string, unknown>;
  assert.equal(ctx.pinned, true);
  assert.equal(ctx.mode, "pick_why");
});

test("readNighthawkPickWhy: explicit date scopes the row lookup to that edition", async () => {
  queryRows = [outcomeRow({ edition_for: "2026-07-10" })];
  await mod.readNighthawkPickWhy("CSX", "2026-07-10");
  assert.match(queryCalls[0]!.sql, /edition_for = \$2::date/);
  assert.deepEqual(queryCalls[0]!.params, ["CSX", "2026-07-10"]);
});

test("readNighthawkPickWhy: never published → the honest not-found envelope", async () => {
  const composed = await mod.readNighthawkPickWhy("ZZZQ");
  assert.match(composed.answer, /never appeared in a published Night Hawk edition/);
  assert.equal((composed.context as { mode: string }).mode, "not_found");
});

test("composeNighthawkEditionRead: ticker → pick-why; no ticker → edition; a YYYY-MM-DD in the question scopes the read", async () => {
  queryRows = [outcomeRow()];
  const why = await mod.composeNighthawkEditionRead("CSX", "why was CSX picked tonight?");
  assert.equal((why.context as { mode: string }).mode, "pick_why");

  latestPlayable = editionRow();
  const edition = await mod.composeNighthawkEditionRead(null, "tonight's playbook");
  assert.equal((edition.context as { mode: string }).mode, "edition");

  editionByDate = editionRow({ edition_for: "2026-07-10" });
  await mod.composeNighthawkEditionRead(null, "show the 2026-07-10 edition");
  assert.ok(editionByDateCalls.includes("2026-07-10"));
});

// ── Citation for the other intents ──────────────────────────────────────────────────

test("nighthawkEditionCitationFor: current-edition membership cites the pin — one read, pinned-only", async () => {
  queryRows = [outcomeRow()];
  const c = await mod.nighthawkEditionCitationFor("CSX");
  assert.ok(c);
  assert.match(c!.headline, /CSX LONG · conviction B — in the 2026-07-14 Night Hawk edition/);
  assert.ok(c!.lines.some((l) => /spot 34\.12/.test(l)));
  assert.ok(c!.lines.some((l) => /regime risk-on/.test(l)));
  assert.equal(c!.asOf, "2026-07-13T23:45:00Z");
  // The read is scoped to the CURRENT edition (edition_for >= today ET) — one query.
  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0]!.sql, /edition_for >= \$2::date/);
  assert.deepEqual(queryCalls[0]!.params, ["CSX", "2026-07-14"]);
});

test("nighthawkEditionCitationFor: pulled plays lead with the pull; pre-pinning rows say so", async () => {
  queryRows = [outcomeRow({ pulled: true, pulled_reason: "Pulled pre-open: gap through stop", publish_context: null })];
  const c = await mod.nighthawkEditionCitationFor("CSX");
  assert.match(c!.headline, /\(PULLED pre-open\)$/);
  assert.match(c!.lines[0]!, /Pulled: Pulled pre-open: gap through stop/);
  assert.ok(c!.lines.some((l) => /no decision context on record/.test(l)));
});

test("nighthawkEditionCitationFor: not in the current edition → null; outage → null (never a throw)", async () => {
  assert.equal(await mod.nighthawkEditionCitationFor("CSX"), null);
  queryError = new Error("down");
  assert.equal(await mod.nighthawkEditionCitationFor("CSX"), null);
});

test("renderNighthawkEditionCitation: the markdown block composers append", () => {
  const md = mod.renderNighthawkEditionCitation({
    headline: "CSX LONG · conviction B — in the 2026-07-14 Night Hawk edition",
    lines: ["Pinned at publish: spot 34.12."],
    asOf: null,
  });
  assert.match(md, /^\*\*Night Hawk edition \(overnight, pinned\):\*\* CSX LONG/);
  assert.match(md, /\n- Pinned at publish: spot 34\.12\./);
});

// ── PR-N10: the Debrief — pick-why section + session-debrief read ───────────────────

/** A real debrief pin as debrief-persist.ts writes it (debrief.ts PlayDebrief +
 *  debriefed_at). */
const DEBRIEF = {
  debrief_version: 1,
  debriefed_at: "2026-07-15T20:35:00.000Z",
  ticker: "CSX",
  edition_for: "2026-07-14",
  direction: "LONG",
  conviction: "B",
  outcome: "stop",
  grade_methodology: "v2_fillability",
  pulled: false,
  fill: {
    filled: true,
    fill_edge: 34.1,
    first_touch: "open",
    detail: "opened 33.90 inside/through the band edge 34.1 — filled at the open",
  },
  excursion: {
    entry: 34.1,
    mfe_pct: 1.17,
    mae_pct: -2.93,
    target_distance_pct: 3.81,
    stop_distance_pct: -2.64,
    mfe_vs_target_ratio: 0.31,
    mae_vs_stop_ratio: 1.11,
    detail: "from the fill edge 34.1: best +1.17% / worst -2.93%",
  },
  thesis: [
    { label: "direction", verdict: "refuted", detail: "closed -2.1% against the pinned reference" },
    { label: "entry_band", verdict: "confirmed", detail: "the tape traded into the published band" },
    { label: "regime", verdict: "untestable", detail: "pinned regime is not directional" },
  ],
  failure_mode: {
    tag: "gap_through_stop",
    detail: "opened 33.00 already beyond the published stop 33.2 — the loss was decided before the session",
  },
};

test("readNighthawkDebrief: a real pin round-trips; unversioned/tag-less blobs are NO debrief — never a guess", () => {
  const d = mod.readNighthawkDebrief(DEBRIEF)!;
  assert.equal(d.failure_mode.tag, "gap_through_stop");
  assert.equal(d.fill!.first_touch, "open");
  assert.equal(d.excursion!.mae_vs_stop_ratio, 1.11);
  assert.equal(d.thesis.length, 3);
  assert.equal(d.debriefed_at, "2026-07-15T20:35:00.000Z");
  assert.equal(mod.readNighthawkDebrief(null), null);
  assert.equal(mod.readNighthawkDebrief({ failure_mode: { tag: "clean_win" } }), null); // no version
  assert.equal(mod.readNighthawkDebrief({ debrief_version: 1 }), null); // no primary tag
  assert.equal(mod.readNighthawkDebrief([DEBRIEF]), null);
});

test("buildNighthawkPickWhyEnvelope: 'How it debriefed' renders ONLY from a real pin — verbatim, never recomputed", () => {
  const withPin = mod.buildNighthawkPickWhyEnvelope(
    outcomeRow({ outcome: "stop", next_day_close: 33.0, debrief: DEBRIEF }) as never,
    null
  );
  const titles = withPin.sections.map((s) => s.title);
  assert.ok(titles.includes("How it debriefed"));
  const md = withPin.markdown;
  assert.match(md, /gap through stop/); // the tag, presentation-cased
  assert.match(md, /the loss was decided before the session/); // the pin's own sentence
  assert.match(md, /filled at the open/);
  assert.match(md, /111% of the stop distance consumed/);
  assert.match(md, /direction: REFUTED/);
  assert.match(md, /entry band: CONFIRMED/);
  assert.match(md, /direction refuted: closed -2\.1% against/);

  // No pin (graded or not) → NO section, nothing reconstructed.
  const withoutPin = mod.buildNighthawkPickWhyEnvelope(
    outcomeRow({ outcome: "stop", next_day_close: 33.0 }) as never,
    null
  );
  assert.ok(!withoutPin.sections.some((s) => s.title === "How it debriefed"));
  // A malformed blob is treated as absent, not partially rendered.
  const malformed = mod.buildNighthawkPickWhyEnvelope(
    outcomeRow({ outcome: "stop", next_day_close: 33.0, debrief: { debrief_version: 1 } }) as never,
    null
  );
  assert.ok(!malformed.sections.some((s) => s.title === "How it debriefed"));
});

test("buildNighthawkSessionDebriefEnvelope: honest per-play sections — pinned debriefs verbatim, unpinned graded rows say so", () => {
  const rows = [
    outcomeRow({ ticker: "CSX", outcome: "stop", next_day_close: 33.0, debrief: DEBRIEF }),
    outcomeRow({ ticker: "AMD", outcome: "target", next_day_open: 101, next_day_close: 110.5, session_high: 111, session_low: 100.5, entry_range_low: 100, entry_range_high: 102, target: 110, stop: 95 }),
    outcomeRow({ ticker: "PG", outcome: "unfilled", next_day_close: 160 }),
    outcomeRow({ ticker: "META", pulled: true, pulled_reason: "Pulled pre-open: regime mismatch", outcome: "target", next_day_close: 40 }),
    outcomeRow({ ticker: "ZZZ" }), // pending
  ];
  const env = mod.buildNighthawkSessionDebriefEnvelope("2026-07-14", rows as never);
  assert.match(env.headline, /Night Hawk debrief — 2026-07-14 session/);
  assert.match(env.headline, /1 target/); // AMD only — the pulled META grade is counterfactual
  assert.match(env.headline, /1 stopped/);
  assert.match(env.headline, /1 unfilled/);
  assert.match(env.headline, /1 pulled/);
  assert.match(env.headline, /1 still pending/);
  const md = env.markdown;
  // The pinned play renders its tag + the pin's own sentences.
  assert.match(md, /gap through stop/);
  assert.match(md, /the loss was decided before the session/);
  // Graded-but-unpinned plays are labeled honestly — nothing reconstructed at read time.
  assert.match(md, /No debrief pin on record for this play yet/);
  // The pulled play carries the both-directions exclusion note.
  assert.match(md, /counterfactual-only and excluded from the headline record in BOTH directions/);
  assert.ok(env.unavailableSources!.length >= 1);
});

test("headline counts: pulled grades never count as wins in the session-debrief tallies", () => {
  const rows = [
    outcomeRow({ ticker: "A", outcome: "target", next_day_close: 35, pulled: true, pulled_reason: "x" }),
    outcomeRow({ ticker: "B", outcome: "stop", next_day_close: 33 }),
  ];
  const env = mod.buildNighthawkSessionDebriefEnvelope("2026-07-14", rows as never);
  assert.doesNotMatch(env.headline, /1 target/);
  assert.match(env.headline, /1 stopped · 1 pulled/);
});

test("NH_DEBRIEF_ASK_RE: results asks match; playbook asks never do", () => {
  for (const q of [
    "how did the night hawk plays do?",
    "how did last night's plays turn out",
    "debrief the edition",
    "post-mortem on the plays",
    "last night's plays",
  ]) {
    assert.ok(mod.NH_DEBRIEF_ASK_RE.test(q), `should match: ${q}`);
  }
  for (const q of [
    "tonight's playbook",
    "what are tomorrow's plays?",
    "what's in the edition?",
    "why was CSX picked tonight?",
  ]) {
    assert.ok(!mod.NH_DEBRIEF_ASK_RE.test(q), `should NOT match: ${q}`);
  }
});

test("composeNighthawkEditionRead: a ticker-less results ask routes to the session debrief", async () => {
  queryRows = [outcomeRow({ outcome: "stop", next_day_close: 33.0, debrief: DEBRIEF })];
  const composed = await mod.composeNighthawkEditionRead(null, "how did the night hawk plays do?");
  const ctx = composed.context as { mode: string; edition_for: string; debriefed: number };
  assert.equal(ctx.mode, "session_debrief");
  assert.equal(ctx.edition_for, "2026-07-14");
  assert.equal(ctx.debriefed, 1);
  assert.match(composed.answer, /Night Hawk debrief — 2026-07-14 session/);
});

test("readNighthawkSessionDebrief: nothing graded → honest empty; ledger outage → honest unreadable", async () => {
  queryRows = [];
  const empty = await mod.readNighthawkSessionDebrief();
  assert.equal((empty.context as { mode: string }).mode, "empty");
  assert.match(empty.answer, /No graded Night Hawk plays to debrief yet/);

  queryError = new Error("down");
  const outage = await mod.readNighthawkSessionDebrief();
  assert.equal((outage.context as { mode: string }).mode, "unreadable");
  assert.match(outage.answer, /unreadable/i);
});

// ── PR-L4e-3: edition FRESHNESS (select the latest published edition, not a stale playable one) ──
test("pickLatestEdition: newer any-edition wins; same-date prefers the playable one; nulls handled", () => {
  const older = editionRow({ edition_for: "2026-07-10" });
  const newer = editionRow({ edition_for: "2026-07-14" });
  // A strictly newer edition of any kind must beat an older playable one (the L4e-3 stale bug).
  assert.equal(mod.pickLatestEdition(older, newer)!.edition_for, "2026-07-14");
  // Same date → keep the playable (plays-carrying) row.
  assert.equal(mod.pickLatestEdition(editionRow({ edition_for: "2026-07-14" }), newer)!.edition_for, "2026-07-14");
  // Playable newer than latest-any (shouldn't happen, but be safe) → playable.
  assert.equal(mod.pickLatestEdition(newer, older)!.edition_for, "2026-07-14");
  assert.equal(mod.pickLatestEdition(null, newer)!.edition_for, "2026-07-14");
  assert.equal(mod.pickLatestEdition(older, null)!.edition_for, "2026-07-10");
  assert.equal(mod.pickLatestEdition(null, null), null);
});

test("readNighthawkEdition: 'tomorrow's plays' serves the LATEST edition, not a stale playable one", async () => {
  // The deployed bug: latest playable is 2026-07-10, but a NEWER 2026-07-14 edition exists — the read
  // used to serve the 4-day-old playbook. It must now serve 2026-07-14.
  latestPlayable = editionRow({ edition_for: "2026-07-10" });
  latestAny = editionRow({ edition_for: "2026-07-14" });
  queryRows = [outcomeRow({ edition_for: "2026-07-14" })];
  const composed = await mod.readNighthawkEdition();
  assert.match(composed.answer, /Night Hawk edition for 2026-07-14/);
  assert.doesNotMatch(composed.answer, /2026-07-10/);
  assert.equal((composed.context as { edition_for: string }).edition_for, "2026-07-14");
  // The outcome SELECT is scoped to the FRESH edition.
  assert.deepEqual(queryCalls[queryCalls.length - 1]!.params, ["2026-07-14"]);
});

// ── PR-L4e-1: the OVERALL accountability record ─────────────────────────────────────
test("aggregateOverallRecord: honest win rate; pulled + unfilled EXCLUDED both directions", async () => {
  // 1 target (win) + 8 stops (loss) = 9 scoreable → 11.1%. A pulled target and an unfilled play are
  // both excluded from the denominator (a pulled win adds no win; an unfilled play never traded).
  queryRows = [
    outcomeRow({ ticker: "AAA", edition_for: "2026-07-11", outcome: "target", conviction: "A" }),
    ...Array.from({ length: 8 }, (_, i) =>
      outcomeRow({ ticker: `S${i}`, edition_for: i < 4 ? "2026-07-11" : "2026-07-12", outcome: "stop", conviction: "B" })
    ),
    outcomeRow({ ticker: "PUL", edition_for: "2026-07-12", outcome: "target", pulled: true }),
    outcomeRow({ ticker: "UNF", edition_for: "2026-07-12", outcome: "unfilled" }),
  ];
  const composed = await mod.readNighthawkOverallRecord();
  assert.equal((composed.context as { mode: string }).mode, "overall_record");
  const ctx = composed.context as { scoreable: number; wins: number; losses: number; win_rate_pct: number; editions: number };
  assert.equal(ctx.scoreable, 9);
  assert.equal(ctx.wins, 1);
  assert.equal(ctx.losses, 8);
  assert.equal(ctx.win_rate_pct, 11.1);
  assert.equal(ctx.editions, 2);
  assert.match(composed.answer, /11\.1%/);
  assert.match(composed.answer, /1–8 over 9 scoreable/);
  assert.match(composed.answer, /1 pulled and 1 unfilled/);
  assert.match(composed.answer, /EXCLUDED/);
});

test("readNighthawkOverallRecord: no graded plays → honest empty; store outage → honest unreadable", async () => {
  queryRows = [];
  const empty = await mod.readNighthawkOverallRecord();
  assert.match(empty.answer, /no scoreable plays/i);
  dbIsConfigured = false;
  const down = await mod.readNighthawkOverallRecord();
  assert.match(down.answer, /unreadable this turn/);
  assert.match(down.answer, /no record is being invented/i);
});

test("composeNighthawkEditionRead: a record ask dispatches to the overall record (not edition/debrief)", async () => {
  queryRows = [outcomeRow({ outcome: "target" })];
  const rec = await mod.composeNighthawkEditionRead(null, "what's our track record");
  assert.equal((rec.context as { mode: string }).mode, "overall_record");
  // A ticker still routes to the pick-why, not the record.
  const pick = await mod.composeNighthawkEditionRead("CSX", "why was CSX picked");
  assert.equal((pick.context as { mode: string }).mode, "pick_why");
});
