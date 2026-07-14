// BIE × Cortex bridge tests (PR-H) — hermetic. The IO seams (ledger reader,
// rejection log, dated db reader, the live fetch+compose pipeline) are mocked with
// mock.module BEFORE the module under test is loaded; cortex-read.ts's own dynamic
// imports use RELATIVE specifiers, so the same relative specifiers registered here
// (this file lives in the same directory) resolve to the same URLs and intercept.
//
// Honesty contract under test: pinned blobs render EXACTLY what was recorded (incl.
// the abstain and the pre-wire-in "no verdict pinned" states), the live path
// surfaces per-source absences, and an outage / all-absent composition yields an
// explicit "no verdict" envelope — never a fabricated one.

import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { ZeroDteSetupLogRow } from "@/lib/db";
import type { CortexInputs, CortexVerdict, EvidenceItem } from "@/lib/nighthawk/cortex/types";

// ── Mutable mock state (reset per test) ─────────────────────────────────────────────

let ledgerRows: ZeroDteSetupLogRow[] = [];
let datedRows: ZeroDteSetupLogRow[] = [];
let datedCalls: string[] = [];
let rejectionRows: Array<Record<string, unknown>> = [];
let liveVerdict: CortexVerdict | null = null;
let fetchInputsError: Error | null = null;
let fetchInputsCalls: Array<{ ticker: string; direction: string }> = [];

mock.module("../zerodte/scan", {
  namedExports: {
    readZeroDteLedger: async () => ledgerRows,
  },
});

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    fetchZeroDteSetupLog: async (sessionDate: string) => {
      datedCalls.push(sessionDate);
      return datedRows;
    },
  },
});

mock.module("../zerodte/rejections", {
  namedExports: {
    fetchZeroDteRejections: async () => rejectionRows,
  },
});

mock.module("../nighthawk/cortex/fetch", {
  namedExports: {
    fetchCortexInputs: async (ticker: string, direction: string) => {
      fetchInputsCalls.push({ ticker, direction });
      if (fetchInputsError) throw fetchInputsError;
      return { ticker, direction } as unknown as CortexInputs;
    },
  },
});

// pane.ts (statically imported by cortex-read) links CONVICTION_A_MIN_SCORE from this
// same module — the wholesale mock must keep every export the loaded graph binds.
mock.module("../nighthawk/cortex/compose", {
  namedExports: {
    composeCortexEvidence: (_inputs: CortexInputs): CortexVerdict => {
      if (liveVerdict == null) throw new Error("test forgot to seed liveVerdict");
      return liveVerdict;
    },
    CONVICTION_A_MIN_SCORE: 2,
    CONVICTION_B_MIN_SCORE: 0.75,
    ABSENT_AFTER_HALF_LIVES: 3,
    SOURCE_SUPPORT_CAPS: {},
    cortexDecayFactor: () => 1,
  },
});

let mod: typeof import("./cortex-read");
before(async () => {
  mod = await import("./cortex-read");
});

beforeEach(() => {
  ledgerRows = [];
  datedRows = [];
  datedCalls = [];
  rejectionRows = [];
  liveVerdict = null;
  fetchInputsError = null;
  fetchInputsCalls = [];
});

// ── Fixtures ────────────────────────────────────────────────────────────────────────

function item(over: Partial<EvidenceItem> & Pick<EvidenceItem, "source" | "stance" | "weight" | "detail">): EvidenceItem {
  return { halfLifeSec: 900, asOf: "2026-07-14T14:30:00Z", ...over } as EvidenceItem;
}

/** The FLATTENED entry_context.cortex blob a committed row pins (cortex-gate.ts's
 *  ZeroDteCortexEntryContext wire shape — decision + as_of + flattened verdict). */
const PINNED_PASS_BLOB = {
  abstained: false,
  decision: "PASS",
  as_of: "2026-07-14T14:31:00Z",
  score: 1.85,
  conviction: "A",
  vetoes: [],
  supports: [
    item({ source: "gex-walls", stance: "supports", weight: 1.0, detail: "clean wall path: put wall 180 below spot 182.4, call wall 185 above." }),
    item({ source: "wall-trend", stance: "supports", weight: 1.05, detail: "call wall 185 grew 3 consecutive samples — forming, not fading." }),
  ],
  opposes: [
    item({ source: "vex-charm", stance: "opposes", weight: 0.2, detail: "net VEX negative into the afternoon pin window." }),
  ],
  absent: ["catalyst-news: reader failed (TimeoutError)"],
  narrative: ["CORTEX NVDA long: net score +1.85, conviction A."],
};

const EXIT_BLOB = {
  reason: "thesis_break",
  detail: "Supporting wall dissolved and flow flipped opposing — the entry evidence no longer stands.",
  mark: 1.05,
  pnl_pct: -12.3,
  peak_pnl_pct: 8.1,
  at: "2026-07-14T15:10:00Z",
};

function row(over: Partial<ZeroDteSetupLogRow> = {}): ZeroDteSetupLogRow {
  return {
    session_date: "2026-07-14",
    ticker: "NVDA",
    direction: "long",
    top_strike: 182.5,
    expiry: "2026-07-14",
    score: 62,
    score_max: 71,
    dossier_score: null,
    conviction: "A",
    gross_premium: 1_200_000,
    spike: false,
    underlying_at_flag: 182.4,
    underlying_latest: 183.1,
    flags_json: null,
    first_flagged_at: "2026-07-14T14:31:00Z",
    last_seen_at: "2026-07-14T15:20:00Z",
    close_price: null,
    move_pct: null,
    direction_hit: null,
    graded_at: null,
    entry_premium: 1.2,
    flow_avg_fill: 1.18,
    plan_json: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    status: "OPEN",
    last_mark: 1.31,
    peak_premium: 1.4,
    trough_premium: 1.1,
    gate_calibration_json: null,
    entry_context: {
      vix_open: 16.2,
      spy_bias: "up",
      gamma_regime: "long",
      score: 62,
      committed_at_et: "2026-07-14 10:31 ET",
      cortex: PINNED_PASS_BLOB,
    },
    ...over,
  } as ZeroDteSetupLogRow;
}

function verdict(over: Partial<CortexVerdict> = {}): CortexVerdict {
  return {
    ticker: "NVDA",
    direction: "long",
    asOf: "2026-07-14T15:45:00Z",
    vetoes: [],
    score: 1.2,
    supports: [item({ source: "gex-walls", stance: "supports", weight: 1.0, detail: "clean wall path toward 185." })],
    opposes: [],
    absent: ["opening-harvest: opening window still forming (before 9:45 ET) — harvest not ready"],
    conviction: "B",
    narrative: ["CORTEX NVDA long: net score +1.2, conviction B."],
    ...over,
  };
}

// ── Pure builders: pinned play ──────────────────────────────────────────────────────

test("buildPinnedCortexEnvelope: PASS blob renders the decision, score, conviction, evidence lines, commit context and absent source", () => {
  const env = mod.buildPinnedCortexEnvelope(row());
  assert.equal(env.intent, "cortex_read");
  assert.match(env.headline, /NVDA/);
  assert.match(env.headline, /PASS/);
  assert.match(env.headline, /\+1\.85/);
  assert.match(env.headline, /conviction A/);
  assert.equal(env.bias, "bullish"); // evidence FOR a long
  // Evidence table carries the signed decayed weights + source tags.
  const md = env.markdown;
  assert.match(md, /\+1\.00 \[gex-walls\]/);
  assert.match(md, /\+1\.05 \[wall-trend\]/);
  assert.match(md, /−0\.20 \[vex-charm\]/);
  // Commit context (entry_context scalars) is cited.
  assert.match(md, /VIX open 16\.2/);
  assert.match(md, /SPY bias up/);
  assert.match(md, /committed 2026-07-14 10:31 ET/);
  // The absent source is surfaced, never hidden.
  assert.ok(env.unavailableSources?.some((u) => u.source.includes("catalyst-news")));
  assert.equal(env.confidence.level, "high");
});

test("buildPinnedCortexEnvelope: VETO blob reads bearish-for-a-long and shows the veto line", () => {
  const blob = {
    ...PINNED_PASS_BLOB,
    decision: "VETO",
    vetoes: [item({ source: "flow-quality", stance: "veto", weight: 1, detail: "3 opposing whale blocks ($4.1M) against the long." })],
  };
  const env = mod.buildPinnedCortexEnvelope(row({ entry_context: { cortex: blob } }));
  assert.match(env.headline, /VETO/);
  assert.equal(env.bias, "bearish");
  assert.match(env.markdown, /VETO \[flow-quality\]/);
});

test("buildPinnedCortexEnvelope: exit context renders the thesis-break story with the recorded P&L", () => {
  const r = row({
    status: "CLOSED",
    plan_outcome: "stopped",
    plan_pnl_pct: -12.3,
    entry_context: { ...row().entry_context, exit: EXIT_BLOB },
  });
  const env = mod.buildPinnedCortexEnvelope(r);
  const exitSection = env.sections.find((s) => s.title === "What the exit engine did");
  assert.ok(exitSection, "exit section present");
  assert.match(exitSection!.body, /thesis break/);
  assert.match(exitSection!.body, /-12\.3%/);
  assert.match(exitSection!.body, /peak \+8\.1%/);
  assert.match(exitSection!.body, /Supporting wall dissolved/);
});

test("buildPinnedCortexEnvelope: gate_calibration_json scalars render when present", () => {
  const env = mod.buildPinnedCortexEnvelope(row({ gate_calibration_json: { verdict: "CONFIRM", tier: "15-17", win_rate_pct: 69 } }));
  const s = env.sections.find((x) => x.title === "Gate calibration at commit");
  assert.ok(s);
  assert.match(s!.body, /verdict: CONFIRM/);
  assert.match(s!.body, /tier: 15-17/);
  assert.match(s!.body, /win rate pct: 69/);
});

test("buildPinnedCortexEnvelope: ABSTAIN blob renders the honest abstain — no score, no conviction, nothing fabricated", () => {
  const env = mod.buildPinnedCortexEnvelope(
    row({ entry_context: { cortex: { abstained: true, reason: "no Cortex source produced evidence (8 absent) — commit proceeds on the hard gates alone." } } })
  );
  assert.match(env.headline, /ABSTAINED/);
  assert.match(env.markdown, /hard gates alone/);
  assert.doesNotMatch(env.markdown, /score \+/);
  assert.doesNotMatch(env.markdown, /conviction A/);
});

test("buildPinnedCortexEnvelope: pre-wire-in row (no cortex blob) states gates-only — never a guessed verdict", () => {
  const env = mod.buildPinnedCortexEnvelope(row({ entry_context: null }));
  assert.match(env.headline, /no Cortex verdict pinned/);
  assert.match(env.markdown, /hard gates alone/);
  assert.equal(env.evidence.length, 0);
});

test("buildPinnedCortexEnvelope: malformed cortex blob reads as no-verdict (structural read), never a crash or partial table", () => {
  const env = mod.buildPinnedCortexEnvelope(
    row({ entry_context: { cortex: { decision: "PASS", score: "not-a-number", vetoes: "nope" } } })
  );
  assert.match(env.headline, /no Cortex verdict pinned/);
});

// ── Pure builders: live verdict ─────────────────────────────────────────────────────

test("buildLiveCortexEnvelope: active verdict renders score/conviction, the would-do line, and per-source absences", () => {
  const env = mod.buildLiveCortexEnvelope(verdict());
  assert.match(env.headline, /net score \+1\.2/);
  assert.match(env.headline, /conviction B/);
  assert.match(env.markdown, /PASS — the evidence layer would let a gate-passing commit through/);
  assert.match(env.markdown, /LIVE composition/);
  assert.ok(env.unavailableSources?.some((u) => u.source.includes("opening-harvest")));
  assert.equal(env.asOf, "2026-07-14T15:45:00Z");
});

test("buildLiveCortexEnvelope: vetoed verdict says the gate stack would block", () => {
  const env = mod.buildLiveCortexEnvelope(
    verdict({ vetoes: [item({ source: "flow-quality", stance: "veto", weight: 1, detail: "opposing whale blocks." })], score: 1.6 })
  );
  assert.match(env.headline, /BLOCKED by 1 veto/);
  assert.match(env.markdown, /VETO — the gate stack would block this commit outright/);
  assert.equal(env.bias, "bearish");
});

test("buildLiveCortexEnvelope: net-negative verdict says a gate-passing setup still doesn't print", () => {
  const env = mod.buildLiveCortexEnvelope(verdict({ score: -0.4, supports: [], opposes: [item({ source: "sector-heat", stance: "opposes", weight: 0.4, detail: "sector red vs the long." })] }));
  assert.match(env.markdown, /NET-NEGATIVE — a gate-passing setup with net-negative evidence still doesn't print/);
});

test("buildLiveCortexEnvelope: ALL-ABSENT verdict is an honest no-verdict (insufficient) — never a neutral score", () => {
  const env = mod.buildLiveCortexEnvelope(
    verdict({ vetoes: [], supports: [], opposes: [], score: 0, conviction: "C", absent: ["gex-walls: reader failed (TimeoutError)", "flow-quality: no prints"] })
  );
  assert.match(env.headline, /cannot see NVDA/);
  assert.equal(env.confidence.level, "insufficient");
  assert.doesNotMatch(env.markdown, /net score/);
  assert.equal(env.unavailableSources?.length, 2);
});

// ── IO: readCortexForPlay ───────────────────────────────────────────────────────────

test("readCortexForPlay: pinned ledger row wins and carries the pinned blob in context", async () => {
  ledgerRows = [row()];
  const composed = await mod.readCortexForPlay("nvda");
  assert.ok(composed);
  assert.match(composed!.answer, /Cortex PASS/);
  assert.equal((composed!.context as { mode: string }).mode, "pinned");
});

test("readCortexForPlay: SPX ask finds the SPXW ledger row (index chain family)", async () => {
  ledgerRows = [row({ ticker: "SPXW" })];
  const composed = await mod.readCortexForPlay("SPX");
  assert.ok(composed);
  assert.equal((composed!.context as { ticker: string }).ticker, "SPXW");
});

test("readCortexForPlay: explicit sessionDate reads the dated ledger, not today's", async () => {
  datedRows = [row({ session_date: "2026-07-11" })];
  const composed = await mod.readCortexForPlay("NVDA", "2026-07-11");
  assert.ok(composed);
  assert.deepEqual(datedCalls, ["2026-07-11"]);
});

test("readCortexForPlay: no ledger row + rejection rows → the skip envelope with gate labels, Cortex blocks flagged", async () => {
  rejectionRows = [
    { id: 1, observed_at: "2026-07-14T14:05:00Z", session_date: "2026-07-14", ticker: "AMD", gate_failed: "cortex_veto:flow-quality", reason: "Cortex veto [flow-quality]: opposing whale blocks.", direction: "long", threshold: null, gross_premium: 500000, aggression: null, side_dominance: null, otm_pct: null, prints: 4, first_seen: null, last_seen: null },
    { id: 2, observed_at: "2026-07-14T14:20:00Z", session_date: "2026-07-14", ticker: "AMD", gate_failed: "score_floor", reason: "score 48 below the floor.", direction: "long", threshold: 55, gross_premium: 500000, aggression: null, side_dominance: null, otm_pct: null, prints: 4, first_seen: null, last_seen: null },
  ];
  const composed = await mod.readCortexForPlay("AMD");
  assert.ok(composed);
  assert.match(composed!.answer, /Why AMD was skipped — Cortex block on record/);
  assert.match(composed!.answer, /cortex · veto \[flow-quality\]/);
  assert.match(composed!.answer, /G-3 · score floor/);
});

test("readCortexForPlay: no play and no skip on record → null (caller falls through to live)", async () => {
  assert.equal(await mod.readCortexForPlay("TSLA"), null);
});

// ── IO: composeCortexLive / composeCortexRead ───────────────────────────────────────

test("composeCortexLive: composes over the live pipeline and threads direction", async () => {
  liveVerdict = verdict({ direction: "short", score: 0.9 });
  const composed = await mod.composeCortexLive("NVDA", "short");
  assert.match(composed.answer, /Cortex live read — NVDA short/);
  assert.deepEqual(fetchInputsCalls, [{ ticker: "NVDA", direction: "short" }]);
});

test("composeCortexLive: composer outage → honest 'no verdict' envelope, never fabricated", async () => {
  fetchInputsError = new Error("boom");
  const composed = await mod.composeCortexLive("NVDA", "long");
  assert.match(composed.answer, /Cortex read unavailable for NVDA/);
  assert.match(composed.answer, /No verdict exists this turn — nothing is fabricated/);
  assert.equal(composed.envelope?.confidence.level, "insufficient");
});

test("composeCortexRead: pinned play beats the live path; live only when no record exists", async () => {
  ledgerRows = [row()];
  liveVerdict = verdict();
  const pinned = await mod.composeCortexRead("NVDA", "why did we commit NVDA");
  assert.equal((pinned.context as { mode: string }).mode, "pinned");
  assert.equal(fetchInputsCalls.length, 0, "live pipeline untouched when a pinned record exists");

  ledgerRows = [];
  const live = await mod.composeCortexRead("NVDA", "what does cortex say about NVDA");
  assert.equal((live.context as { mode: string }).mode, "live");
});

test("composeCortexRead: direction is parsed from the question for the live path", async () => {
  liveVerdict = verdict({ direction: "short" });
  await mod.composeCortexRead("NVDA", "cortex read on NVDA puts");
  assert.equal(fetchInputsCalls[0]?.direction, "short");
});

test("composeCortexRead: ticker-less question → session overview of pinned decisions", async () => {
  ledgerRows = [
    row(),
    row({ ticker: "MU", direction: "short", top_strike: 110, entry_context: { cortex: { abstained: true, reason: "every source absent." } } }),
  ];
  rejectionRows = [
    { id: 3, observed_at: "2026-07-14T14:40:00Z", session_date: "2026-07-14", ticker: "AMD", gate_failed: "cortex_net_negative", reason: "Cortex evidence nets -0.4.", direction: "long", threshold: 0, gross_premium: 1, aggression: null, side_dominance: null, otm_pct: null, prints: 1, first_seen: null, last_seen: null },
    { id: 4, observed_at: "2026-07-14T14:41:00Z", session_date: "2026-07-14", ticker: "PLTR", gate_failed: "score_floor", reason: "score 41.", direction: "long", threshold: 55, gross_premium: 1, aggression: null, side_dominance: null, otm_pct: null, prints: 1, first_seen: null, last_seen: null },
  ];
  const composed = await mod.composeCortexRead(null, "why was the top play picked");
  assert.match(composed.answer, /2 committed plays/);
  assert.match(composed.answer, /1 Cortex-blocked skip/); // score_floor skip is NOT a cortex block
  assert.match(composed.answer, /NVDA 182\.5c: Cortex PASS/);
  assert.match(composed.answer, /MU 110p: Cortex ABSTAINED/);
  assert.match(composed.answer, /AMD skipped — cortex · net-negative/);
  assert.doesNotMatch(composed.answer, /PLTR/);
});

test("composeCortexRead: ticker-less question with an empty record → honest empty state", async () => {
  const composed = await mod.composeCortexRead(null, "why was the top play picked");
  assert.match(composed.answer, /No 0DTE decisions on record this session/);
});

// ── Citation for the other intents ──────────────────────────────────────────────────

test("cortexCitationFor: pinned mode when a play exists — vetoes first, top evidence by |weight|", async () => {
  ledgerRows = [row()];
  const c = await mod.cortexCitationFor("NVDA", { allowLive: true });
  assert.equal(c?.mode, "pinned");
  assert.match(c!.headline, /Cortex PASS \(pinned at commit, 2026-07-14\): score \+1\.85, conviction A/);
  assert.equal(c!.lines.length, 3);
  assert.match(c!.lines[0]!, /wall-trend/); // 1.05 beats 1.00
});

test("cortexCitationFor: live mode when no record and allowLive", async () => {
  liveVerdict = verdict();
  const c = await mod.cortexCitationFor("NVDA", { allowLive: true });
  assert.equal(c?.mode, "live");
  assert.match(c!.headline, /net score \+1\.2, conviction B/);
});

test("cortexCitationFor: pinned-only call sites get null when no record exists (no live composition)", async () => {
  const c = await mod.cortexCitationFor("NVDA", { allowLive: false });
  assert.equal(c, null);
  assert.equal(fetchInputsCalls.length, 0);
});

test("cortexCitationFor: outage → honest 'unavailable' citation, never a throw", async () => {
  fetchInputsError = new Error("down");
  const c = await mod.cortexCitationFor("NVDA", { allowLive: true });
  assert.equal(c?.mode, "unavailable");
  assert.match(c!.headline, /unavailable/);
});

test("cortexCitationFor: all-absent live verdict → 'cannot see', mode unavailable", async () => {
  liveVerdict = verdict({ vetoes: [], supports: [], opposes: [], score: 0, absent: ["a: x", "b: y"] });
  const c = await mod.cortexCitationFor("NVDA", { allowLive: true });
  assert.equal(c?.mode, "unavailable");
  assert.match(c!.headline, /cannot see NVDA/);
});

test("pinnedCortexLinesForSession: one line per ledger ticker, honest on abstain and missing blobs", async () => {
  ledgerRows = [
    row(),
    row({ ticker: "MU", entry_context: { cortex: { abstained: true, reason: "every source absent." } } }),
    row({ ticker: "OLD", entry_context: null }),
  ];
  const map = await mod.pinnedCortexLinesForSession();
  assert.match(map.get("NVDA")!, /Cortex PASS at commit — score \+1\.85, conviction A/);
  assert.match(map.get("MU")!, /ABSTAINED/);
  assert.match(map.get("OLD")!, /no verdict pinned — gates-only commit/);
});

test("renderCortexCitation + directionFromQuestion", () => {
  const md = mod.renderCortexCitation({ mode: "pinned", headline: "Cortex PASS: score +1, conviction B", lines: ["+1.00 [gex-walls] x"], asOf: null });
  assert.match(md, /\*\*Cortex evidence \(0DTE, pinned\):\*\* Cortex PASS/);
  assert.match(md, /- \+1\.00 \[gex-walls\] x/);
  assert.equal(mod.directionFromQuestion("should I short NVDA"), "short");
  assert.equal(mod.directionFromQuestion("NVDA puts?"), "short");
  assert.equal(mod.directionFromQuestion("cortex NVDA"), "long");
});
