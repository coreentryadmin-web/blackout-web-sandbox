import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayKanbanChips } from "./spx-play-kanban-chips";
import type { SpxPlayPayload } from "./spx-play-engine";
import { eligiblePlaybookIds } from "./playbook-regime-router";
import { isPlaybookLiveAllowlisted, playbookLiveAllowlist } from "./spx-play-config";
import type { SpxDeskPayload } from "./spx-desk";
import { mergeVolumeIntoBars, sessionStatsFromMinuteBars } from "@/lib/providers/spx-session";
import { PLAYBOOK_REGISTRY } from "./playbook-registry";

// STAGING FULL-ENABLEMENT (user directive): on staging the WHOLE SPX Slayer engine runs live; every
// change is gated by isStagingDeploy() (which reads NEXT_PUBLIC_SITE_URL) so PROD is UNCHANGED. These
// tests toggle that URL to assert both the staging-enabled and the prod-conservative branches.

function withDeploy(url: string, fn: () => void): void {
  const savedSite = process.env.NEXT_PUBLIC_SITE_URL;
  const savedAllow = process.env.PLAYBOOK_LIVE_ALLOWLIST;
  process.env.NEXT_PUBLIC_SITE_URL = url;
  delete process.env.PLAYBOOK_LIVE_ALLOWLIST; // no env override → default/full-enablement path
  try {
    fn();
  } finally {
    if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
    if (savedAllow === undefined) delete process.env.PLAYBOOK_LIVE_ALLOWLIST;
    else process.env.PLAYBOOK_LIVE_ALLOWLIST = savedAllow;
  }
}
const STAGING = "https://staging.blackouttrades.com";
const PROD = "https://blackouttrades.com";

// ── 1) ALLOWLIST: staging enables all PB-01..PB-14; prod keeps the conservative default ──────────
test("allowlist: STAGING makes every playbook paper-executable", () => {
  withDeploy(STAGING, () => {
    const allow = playbookLiveAllowlist();
    assert.ok(allow, "staging allowlist non-null");
    assert.equal(allow!.size, PLAYBOOK_REGISTRY.length);
    for (const pb of PLAYBOOK_REGISTRY) {
      assert.equal(isPlaybookLiveAllowlisted(pb.id), true, `${pb.id} allowlisted on staging`);
    }
  });
});

test("allowlist: PROD is UNCHANGED — mvp playbooks stay shadow-only", () => {
  withDeploy(PROD, () => {
    // Prod, no env allowlist → null (legacy path); mvp matchers (PB-06/PB-11/PB-14) are NOT executable.
    assert.equal(playbookLiveAllowlist(), null);
    assert.equal(isPlaybookLiveAllowlisted("PB-06"), false);
    assert.equal(isPlaybookLiveAllowlisted("PB-14"), false);
    // High-fidelity paper-executable core still passes on prod.
    assert.equal(isPlaybookLiveAllowlisted("PB-01"), true);
  });
});

// ── 2) REGIME ELIGIBILITY: staging makes the whole set eligible; prod filters by bucket ──────────
test("regime: STAGING makes every playbook regime-eligible (mean-reversion family included)", () => {
  const desk = { regime: "bullish" } as SpxDeskPayload; // trend bucket would exclude mean-reversion
  withDeploy(STAGING, () => {
    const ids = eligiblePlaybookIds(desk, Date.parse("2026-07-13T15:00:00Z"));
    assert.equal(ids.length, PLAYBOOK_REGISTRY.length);
    assert.ok(ids.includes("PB-04")); // mean-reversion — excluded by trend bucket on prod
    assert.ok(ids.includes("PB-11"));
  });
});

test("regime: PROD is UNCHANGED — a bullish trend regime excludes the mean-reversion family", () => {
  const desk = { regime: "bullish" } as SpxDeskPayload;
  withDeploy(PROD, () => {
    const ids = eligiblePlaybookIds(desk, Date.parse("2026-07-13T15:00:00Z")); // after opening drive
    // Prod filters by the trend regime bucket → a strict subset of the full set (unlike staging).
    assert.ok(ids.length < PLAYBOOK_REGISTRY.length, "prod filters by regime bucket");
  });
});

// ── 3) VWAP PROXY: merging proxy volume yields a TRUE volume-weighted VWAP ───────────────────────
test("vwap proxy: mergeVolumeIntoBars flips vwap_volume_weighted true and weights the mean", () => {
  const t1 = Date.parse("2026-07-13T14:00:00Z"); // 10:00 ET — inside RTH
  const t2 = t1 + 60_000;
  const bars = [
    { t: t1, o: 100, h: 102, l: 98, c: 100, v: 0 }, // typical 100
    { t: t2, o: 100, h: 112, l: 108, c: 110, v: 0 }, // typical 110
  ];
  // Without volume: equal-weight typical price = 105, flagged NOT volume-weighted.
  const plain = sessionStatsFromMinuteBars(bars);
  assert.equal(plain.vwap_volume_weighted, false);
  assert.equal(plain.vwap, 105);
  // With proxy volume heavily weighting the 110 bar: VWAP pulls toward 110, flagged volume-weighted.
  const volMap = new Map<number, number>([
    [Math.floor(t1 / 1000), 100],
    [Math.floor(t2 / 1000), 900],
  ]);
  const merged = sessionStatsFromMinuteBars(mergeVolumeIntoBars(bars, volMap));
  assert.equal(merged.vwap_volume_weighted, true);
  assert.ok(merged.vwap! > 108, `volume-weighted VWAP ${merged.vwap} pulled toward the heavy bar`);
  // Bars already carrying real volume are untouched; empty map is a no-op.
  assert.deepEqual(mergeVolumeIntoBars(bars, new Map()), bars);
});

// ── 4) WATCH VISIBILITY: a sub-threshold SCANNING candidate surfaces as an honest low-conviction chip
const scanningPlay = {
  available: true,
  phase: "SCANNING",
  action: "SCANNING",
  direction: "long",
  grade: "D",
  score: 27,
  confidence: 40,
  headline: "Levels loading",
  thesis: "",
  levels: { entry: 7552, stop: 7547, target: 7566, invalidation: "" },
  option_ticket: { contract_label: "7550C", premium_range: "3-5", delta: 0.3 },
} as SpxPlayPayload;

test("watch: STAGING surfaces the SCANNING candidate as a low-conviction watch chip", () => {
  withDeploy(STAGING, () => {
    const cols = buildPlayKanbanChips({
      play: scanningPlay,
      lotto: null,
      powerHour: null,
      history: [],
      filter: "all",
      structureOpen: false,
      structureWatch: false, // below the watch floor — nothing stronger qualifies
      sessionLive: true,
    });
    assert.equal(cols.watch.length, 1, "a watch chip renders");
    assert.equal(cols.watch[0].id, "structure-scanning");
    assert.match(cols.watch[0].label, /SCAN/); // truthfully labeled, not a strong play
    assert.match(cols.watch[0].label, /D/); // shows the real grade
    assert.equal(cols.open.length, 0, "never dressed as an open play");
  });
});

test("watch: PROD is UNCHANGED — a sub-threshold SCANNING candidate renders nothing", () => {
  withDeploy(PROD, () => {
    const cols = buildPlayKanbanChips({
      play: scanningPlay,
      lotto: null,
      powerHour: null,
      history: [],
      filter: "all",
      structureOpen: false,
      structureWatch: false,
      sessionLive: true,
    });
    assert.equal(cols.watch.length, 0);
    assert.equal(cols.open.length, 0);
  });
});
