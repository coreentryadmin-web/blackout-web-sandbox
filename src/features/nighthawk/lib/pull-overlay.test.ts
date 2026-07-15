import assert from "node:assert/strict";
import test from "node:test";
import { applyNighthawkPullOverlay } from "./pull-overlay";
import type { NightHawkEdition, PlaybookPlay } from "./types";
import type { NighthawkPulledPlay } from "@/lib/db";

// PR-N4: the member-surface half of "INVALIDATED becomes binding". Contract: a pulled
// play is PRESENTED as pulled (flag + reason) at its published rank — never removed,
// never reordered, never hidden — and everything else on the payload is untouched.

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "AMD",
    direction: "LONG",
    conviction: "A+",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$137.00-$138.50",
    target: "$140.00",
    stop: "$134.00",
    options_play: "AMD 140C",
    ...overrides,
  };
}

function edition(plays: PlaybookPlay[]): NightHawkEdition {
  return {
    available: true,
    edition_for: "2026-07-07",
    published_at: "2026-07-06T21:35:00.000Z",
    recap_headline: "h",
    recap_summary: "s",
    market_recap: {},
    plays,
  };
}

function pulledRow(overrides: Partial<NighthawkPulledPlay> = {}): NighthawkPulledPlay {
  return {
    ticker: "AMD",
    pulled_reason: "Pulled pre-open: AMD pre-market 128.20 has gapped through the stop (134)",
    pulled_at: "2026-07-07T13:15:30.000Z",
    ...overrides,
  };
}

test("pulled play stays visible at its rank, stamped pulled + reason; siblings untouched", () => {
  const base = edition([play(), play({ rank: 2, ticker: "TSLA" })]);
  const out = applyNighthawkPullOverlay(base, [pulledRow()]);

  assert.equal(out.plays.length, 2, "never deleted — pulled plays stay visible as pulled");
  assert.equal(out.plays[0].ticker, "AMD");
  assert.equal(out.plays[0].rank, 1, "published rank preserved");
  assert.equal(out.plays[0].pulled, true);
  assert.match(out.plays[0].pulled_reason ?? "", /gapped through the stop/);
  // Sibling is the SAME object — the overlay is surgical.
  assert.equal(out.plays[1], base.plays[1]);
  assert.equal(out.plays[1].pulled, undefined);
});

test("ticker match is case-insensitive and non-destructive (input edition not mutated)", () => {
  const base = edition([play({ ticker: "amd" })]);
  const out = applyNighthawkPullOverlay(base, [pulledRow({ ticker: "AMD" })]);
  assert.equal(out.plays[0].pulled, true);
  assert.equal(base.plays[0].pulled, undefined, "original payload object untouched");
});

test("null pulled_reason gets the honest generic fallback, never an empty badge", () => {
  const out = applyNighthawkPullOverlay(edition([play()]), [pulledRow({ pulled_reason: null })]);
  assert.equal(out.plays[0].pulled_reason, "Pulled pre-open by the morning confirmation check");
});

test("no pulled rows / no plays: the exact same edition object passes through", () => {
  const e1 = edition([play()]);
  assert.equal(applyNighthawkPullOverlay(e1, []), e1);
  const e2 = edition([]);
  assert.equal(applyNighthawkPullOverlay(e2, [pulledRow()]), e2);
});

test("a pulled row whose play left the payload is ignored (annotate what is served, invent nothing)", () => {
  const base = edition([play({ ticker: "TSLA" })]);
  const out = applyNighthawkPullOverlay(base, [pulledRow({ ticker: "AMD" })]);
  assert.equal(out, base);
  assert.equal(out.plays.length, 1);
});

// DEGRADED-not-excluded, at the surface layer: only rows the DB latch marked pulled are
// stamped — a DEGRADED verdict never produces a pulled row (see morning-verdict-persist
// tests), so a degraded play passes through here completely untouched.
test("DEGRADED plays are not pulled: absent from the latch, untouched by the overlay", () => {
  const degraded = play({ ticker: "TSLA", rank: 2 });
  const base = edition([play(), degraded]);
  const out = applyNighthawkPullOverlay(base, [pulledRow()]); // only AMD latched
  assert.equal(out.plays[1], degraded);
  assert.equal(out.plays[1].pulled, undefined);
});
