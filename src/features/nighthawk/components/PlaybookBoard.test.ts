import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  NightHawkEdition,
  NightHawkRecordResponse,
  PlaybookPlay,
  PlayMorningStatus,
} from "@/features/nighthawk/lib/types";

// NOTE: deliberately a .test.ts (createElement, no JSX): CI expands `src/**/*.test.ts`,
// which never matched the old PlaybookBoard.ssr.test.tsx — that suite silently never
// ran. This file replaces it inside the glob CI actually executes.
//
// The components are transpiled with the classic JSX runtime in this test context,
// which expects a global `React` — set it BEFORE importing them (same idiom as
// FreshnessChip.ssr.test.ts, hence the relative dynamic imports inside the helpers;
// top-level await is unavailable in this CJS transform).
(globalThis as unknown as { React: typeof React }).React = React;

const loadBoard = () => import("./PlaybookBoard");
const loadRow = () => import("./PlaybookPlayRow");

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "QCOM",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "Grounded setup off stacked call flow",
    key_signal: "3d call sweep streak above VWAP",
    entry_range: "$200–$202",
    target: "$215",
    stop: "$190",
    options_play: "QCOM CALL $200 2026-08-21, entry prem ~$15.80",
    entry_premium: 15.8,
    entry_cost_per_contract: 1580,
    score: 72,
    ...overrides,
  };
}

function edition(overrides: Partial<NightHawkEdition> = {}): NightHawkEdition {
  return {
    available: true,
    edition_for: "2026-07-14",
    published_at: "2026-07-13T21:30:00.000Z",
    recap_headline: "Evening Playbook · 2026-07-14",
    recap_summary: "Long recap prose that must stay behind the disclosure.",
    market_recap: {
      tide: "Market tide bullish (calls 62%)",
      spx_vix: "SPX 6295 +0.4% · VIX 16.2",
      sector_strength: "Tech 1.23% · Energy 0.88%",
      sector_weakness: "Utilities -0.61%",
      catalysts: "Macro: CPI (high) · Earnings: NVDA",
    },
    plays: [],
    ...overrides,
  };
}

type BoardProps = Parameters<Awaited<ReturnType<typeof loadBoard>>["PlaybookBoard"]>[0];

async function render(props: BoardProps): Promise<string> {
  const { PlaybookBoard } = await loadBoard();
  return renderToStaticMarkup(React.createElement(PlaybookBoard, props));
}

// ── empty states: ONE honest block, never five repeated placeholders ──────────────

test("zero-play unpublished edition renders ONE empty block, no circling slots", async () => {
  const html = await render({
    edition: edition({
      available: false,
      recap_headline: null,
      recap_summary: null,
      market_recap: null,
    }),
  });

  // The old board rendered the same placeholder five times — the exact regression
  // this rebuild removes.
  assert.equal((html.match(/The Hawk is circling/g) ?? []).length, 0);
  assert.equal((html.match(/Playbook publishes after the close/g) ?? []).length, 1);
  assert.match(html, /~5:30 PM ET/);
  // No numbered play cards on an empty night.
  assert.doesNotMatch(html, /aria-label="Play 1:/);
  assert.match(html, /Building/);
});

test("recap-only edition renders the honest gate message once, with the edition date", async () => {
  const html = await render({ edition: edition() });

  assert.equal((html.match(/No plays cleared tonight&#x27;s gates/g) ?? []).length, 1);
  assert.match(html, /Recap only for Tue, Jul 14/);
  // Status pill reflects the recap-only state.
  assert.match(html, /Recap only</);
});

// ── market context: data grid from real payload strings, prose collapsed ──────────

test("market context renders as a label:value grid bound to market_recap fields", async () => {
  const html = await render({ edition: edition() });

  for (const label of ["Tide", "Leaders", "Laggards", "Catalysts"]) {
    assert.ok(html.includes(label), `missing ${label}`);
  }
  assert.match(html, /SPX (·|&#xB7;) VIX/);
  assert.match(html, /Market tide bullish \(calls 62%\)/);
  assert.match(html, /Tech 1\.23%/);
});

test("recap prose is a collapsed disclosure — closed by default, toggle present", async () => {
  const html = await render({ edition: edition() });

  assert.doesNotMatch(html, /Long recap prose that must stay behind the disclosure/);
  assert.match(html, /Market recap/);
  assert.match(html, /aria-expanded="false"/);
});

test("marketContextItems only emits non-empty string fields — nothing invented", async () => {
  const { marketContextItems } = await loadBoard();
  assert.deepEqual(marketContextItems({}), []);
  assert.deepEqual(
    marketContextItems({ tide: "  ", spx_vix: 42, sector_strength: "Tech 1.00%" }),
    [{ label: "Leaders", value: "Tech 1.00%", wide: undefined }]
  );
});

// ── plays: numbered evidence-first cards, only for actual plays ────────────────────

test("plays render as cards at their published ranks; carry-until-close notice intact", async () => {
  const html = await render({
    edition: edition({
      carry_until_close: true,
      plays: [play(), play({ rank: 2, ticker: "NVDA", direction: "SHORT", entry_range: "$170–$171" })],
    }),
  });

  assert.match(html, /aria-label="Play 1: QCOM LONG/);
  assert.match(html, /aria-label="Play 2: NVDA SHORT/);
  // Exactly two cards — no padded empty slots 3..5.
  assert.equal((html.match(/aria-label="Play \d+:/g) ?? []).length, 2);
  assert.match(html, /Today&#x27;s generated plays stay live until the session close/);
  // Plan line binds entry/target/stop payload strings.
  assert.match(html, /\$200(–|&#x2013;)\$202/);
  assert.match(html, /\$215/);
  assert.match(html, /\$190/);
  // Header shows LIVE + play count.
  assert.match(html, /Live</);
  assert.match(html, /2 plays/);
});

test("pulled play keeps #331 semantics: badge, reason line, struck levels, dimmed card", async () => {
  const html = await render({
    edition: edition({
      plays: [
        play({
          pulled: true,
          pulled_reason: "SPX gapped through the entry band pre-open",
        }),
      ],
    }),
  });

  assert.match(html, />Pulled</);
  assert.match(html, /SPX gapped through the entry band pre-open/);
  assert.match(html, /line-through/);
  assert.match(html, /opacity-60/);
});

test("morning verdict chip + pre-market summary render from the play-status payload", async () => {
  const confirm: PlayMorningStatus = {
    rank: 1,
    ticker: "QCOM",
    direction: "LONG",
    status: "CONFIRMED",
    reason: "Still above the entry band pre-market",
  };
  const html = await render({
    edition: edition({ plays: [play()] }),
    confirmByTicker: new Map([["QCOM", confirm]]),
    playStatusAvailable: true,
    morningConfirmCheckedAt: "2026-07-14T13:00:00.000Z",
  });

  assert.match(html, />Confirmed</);
  assert.match(html, /Pre-market/);
  assert.match(html, /1 confirmed/);
});

// ── record chip: LOW-N aware, same disclosure gate as the record strip ─────────────

function record(overrides: Partial<NightHawkRecordResponse> = {}): NightHawkRecordResponse {
  return {
    available: true,
    window_days: 30,
    total_resolved: 42,
    pending_count: 3,
    win_rate_pct: 57,
    profitable_rate_pct: 64,
    avg_return_pct: 11,
    by_conviction: [],
    ...overrides,
  };
}

test("record chip below the minimum sample is an amber LOW-N marker, never a win rate", async () => {
  const html = await render({ edition: edition(), record: record({ total_resolved: 4 }) });

  assert.match(html, /record 4\/30 (·|&#xB7;) low n/);
  assert.doesNotMatch(html, /% WR/);
});

test("record chip at/above the minimum sample shows n resolved and the win rate", async () => {
  const html = await render({ edition: edition(), record: record() });

  assert.match(html, /42 resolved (·|&#xB7;) 57% WR/);
});

// ── honesty notices + status pill precedence ───────────────────────────────────────

test("stale edition shows the prior-edition notice and never asserts Live", async () => {
  const html = await render({
    edition: edition({ stale: true, served_for: "2026-07-10", plays: [play()] }),
  });

  assert.match(html, /Prior edition/);
  assert.match(html, /isn&#x27;t\s*published yet/);
  assert.doesNotMatch(html, />Live</);
});

test("resolveEditionStatus precedence: syncing > stale/degraded > live > recap-only > building", async () => {
  const { resolveEditionStatus } = await loadBoard();
  const base = { loading: false, hasPlays: false, isStale: false, isDegraded: false, recapState: false };
  assert.equal(resolveEditionStatus({ ...base, loading: true, hasPlays: true }).label, "Syncing");
  assert.equal(resolveEditionStatus({ ...base, isStale: true, hasPlays: true }).label, "Prior edition");
  assert.equal(resolveEditionStatus({ ...base, isDegraded: true, hasPlays: true }).label, "Legacy source");
  assert.equal(resolveEditionStatus({ ...base, hasPlays: true }).label, "Live");
  assert.equal(resolveEditionStatus({ ...base, recapState: true }).label, "Recap only");
  assert.equal(resolveEditionStatus(base).label, "Building");
});

// ── unrounded-float guard on everything rendered ───────────────────────────────────

test("float-tainted score renders rounded — no 72.6000000001-style artifacts", async () => {
  const html = await render({
    edition: edition({ plays: [play({ score: 72.60000000000001 })] }),
  });

  assert.doesNotMatch(html, /72\.6000/);
  assert.match(html, />73</);
});

test("fmtScore / fmtIvRank guard malformed numbers", async () => {
  const { fmtIvRank, fmtScore } = await loadRow();
  assert.equal(fmtScore(72.60000000000001), "73");
  assert.equal(fmtScore(undefined), "—");
  assert.equal(fmtScore(Number.NaN), "—");
  assert.equal(fmtIvRank(0.42), "42%");
  assert.equal(fmtIvRank(87.00000000000003), "87%");
  assert.equal(fmtIvRank(140), "100%");
});

test("morningBadgeLabel never lets UNVERIFIED read as an adverse verdict", async () => {
  const { morningBadgeLabel } = await loadRow();
  assert.equal(morningBadgeLabel("UNVERIFIED"), "Unverified");
  assert.equal(morningBadgeLabel("INVALIDATED"), "Invalidated");
  assert.equal(morningBadgeLabel("CONFIRMED"), "Confirmed");
  assert.equal(morningBadgeLabel("DEGRADED"), "Degraded");
});
