import { test } from "node:test";
import assert from "node:assert/strict";
import { BIE_TOOL_NAMES, LARGO_TOOL_DEFS, SPX_ENGINE_TOOL_NAMES, TOOL_GROUPS } from "./tool-defs";

test("BIE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of BIE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in BIE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("BIE_TOOL_NAMES: every name is reachable through TOOL_GROUPS.platform", () => {
  for (const name of BIE_TOOL_NAMES) {
    assert.ok(
      TOOL_GROUPS.platform.includes(name),
      `${name} is in BIE_TOOL_NAMES but not routed via TOOL_GROUPS.platform — Largo would never call it`
    );
  }
});

test("BIE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(BIE_TOOL_NAMES).size, BIE_TOOL_NAMES.length);
});

// ── Task #112: SPX_ENGINE_TOOL_NAMES (calibration.ts's SPX-tool-calling cohort) ──

test("SPX_ENGINE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of SPX_ENGINE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in SPX_ENGINE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("SPX_ENGINE_TOOL_NAMES: every name is a subset of TOOL_GROUPS.spx_desk", () => {
  for (const name of SPX_ENGINE_TOOL_NAMES) {
    assert.ok(
      (TOOL_GROUPS.spx_desk as readonly string[]).includes(name),
      `${name} is in SPX_ENGINE_TOOL_NAMES but not in TOOL_GROUPS.spx_desk — the cohort must stay a NARROWING of the desk bundle, never wander outside it`
    );
  }
});

test("SPX_ENGINE_TOOL_NAMES: excludes the generic ticker-scoped tools bundled into spx_desk for convenience", () => {
  // These take a ticker/group input and hit the same generic UW/Polygon providers
  // used for ANY ticker (see run-tool.ts) — a turn calling only these says nothing
  // about SPX-Slayer-engine-state answer quality specifically.
  for (const generic of ["get_flow_tape", "get_greek_flow", "get_gex", "get_group_greek_flow"]) {
    assert.ok(
      !SPX_ENGINE_TOOL_NAMES.includes(generic),
      `${generic} is generic/ticker-scoped and should not be in the SPX-engine-state cohort`
    );
  }
});

test("SPX_ENGINE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(SPX_ENGINE_TOOL_NAMES).size, SPX_ENGINE_TOOL_NAMES.length);
});

// ── Task #127: get_zerodte_plays vs get_spx_play mis-routing risk ──
// Both SPX Slayer and 0DTE Command ("BlackOut Grid") are branded "0DTE," but they
// are two independent engines (single-instrument SPX/SPXW vs. always-on multi-
// ticker scanner). get_zerodte_plays' description used to be a thin one-liner
// with no disambiguating clause at all — this locks in that the rewritten
// description explicitly tells Claude these are different engines and points to
// get_spx_play for SPX Slayer's own state, so a future edit can't silently drop it.

test("get_zerodte_plays description explicitly disambiguates from SPX Slayer's own tools", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_plays");
  assert.ok(def, "get_zerodte_plays must be a registered Largo tool");
  assert.match(
    def!.description,
    /different|DIFFERENT/,
    "expected get_zerodte_plays description to call out that it is a different engine from SPX Slayer"
  );
  assert.match(
    def!.description,
    /get_spx_play/,
    "expected get_zerodte_plays description to point to get_spx_play for SPX Slayer's own play state"
  );
  assert.match(
    def!.description,
    /multi-ticker|MULTI-TICKER/,
    "expected get_zerodte_plays description to state it scans across multiple tickers, not just SPX"
  );
});

// ── Task #147: get_zerodte_rejections — the 0DTE Command near-miss/gate-rejection
// log, distinct from BOTH get_zerodte_plays (committed-only, same scanner) and
// SPX Slayer's own get_spx_engine_snapshots (task #108, a different engine
// entirely). Locks in the disambiguating language so a future edit can't quietly
// drop it and reintroduce the exact name-confusion risk task #127 fixed.

test("get_zerodte_rejections is a real tool, reachable via TOOL_GROUPS.platform alongside get_zerodte_plays", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_rejections");
  assert.ok(def, "get_zerodte_rejections must be a registered Largo tool");
  assert.ok(
    TOOL_GROUPS.platform.includes("get_zerodte_rejections"),
    "get_zerodte_rejections must be routed via TOOL_GROUPS.platform — Largo would never call it otherwise"
  );
});

test("get_zerodte_rejections description disambiguates from BOTH get_zerodte_plays and SPX Slayer's get_spx_engine_snapshots", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_rejections");
  assert.ok(def);
  assert.match(
    def!.description,
    /get_zerodte_plays/,
    "expected get_zerodte_rejections description to reference get_zerodte_plays (the committed-only sibling tool)"
  );
  assert.match(
    def!.description,
    /get_spx_engine_snapshots/,
    "expected get_zerodte_rejections description to point away from SPX Slayer's own get_spx_engine_snapshots"
  );
  assert.match(
    def!.description,
    /DIFFERENT/,
    "expected get_zerodte_rejections description to explicitly call out it is a different product from SPX Slayer"
  );
});

test("get_zerodte_plays description points forward to get_zerodte_rejections for a candidate that didn't make the board", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_zerodte_plays");
  assert.ok(def);
  assert.match(
    def!.description,
    /get_zerodte_rejections/,
    "expected get_zerodte_plays to point to get_zerodte_rejections for candidates that failed a gate"
  );
});

// Task #136: BlackOut Thermal's GEX regime/flip/wall-crossing transition history
// (gex_regime_events) gets its own Largo tool, direct analogue of get_zerodte_rejections
// above — a genuinely different question from get_positioning/get_gex's CURRENT-state-only
// snapshot.

test("get_gex_regime_events is a real tool, reachable via TOOL_GROUPS.stock_analysis and TOOL_GROUPS.spx_desk", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_gex_regime_events");
  assert.ok(def, "get_gex_regime_events must be a registered Largo tool");
  assert.ok(
    TOOL_GROUPS.stock_analysis.includes("get_gex_regime_events"),
    "get_gex_regime_events must be routed via TOOL_GROUPS.stock_analysis — Largo would never call it otherwise"
  );
  assert.ok(
    (TOOL_GROUPS.spx_desk as readonly string[]).includes("get_gex_regime_events"),
    "get_gex_regime_events should also be reachable from the SPX desk bundle, alongside get_gex"
  );
});

test("get_gex_regime_events description disambiguates from get_positioning/get_gex's current-snapshot-only view", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_gex_regime_events");
  assert.ok(def);
  assert.match(
    def!.description,
    /get_positioning/,
    "expected get_gex_regime_events description to reference get_positioning (the current-snapshot sibling tool)"
  );
  assert.match(
    def!.description,
    /get_gex/,
    "expected get_gex_regime_events description to reference get_gex (the current-snapshot sibling tool)"
  );
  assert.match(
    def!.description,
    /CURRENT/,
    "expected get_gex_regime_events description to explicitly call out the current-vs-history distinction"
  );
});

test("get_gex_regime_events is NOT part of SPX_ENGINE_TOOL_NAMES — generic/ticker-scoped like get_gex, not SPX-Slayer-engine-specific", () => {
  assert.ok(
    !SPX_ENGINE_TOOL_NAMES.includes("get_gex_regime_events"),
    "get_gex_regime_events is a generic ticker-scoped tool (like get_gex/get_positioning), not SPX Slayer's own engine-state cohort"
  );
});

// ── Task #131: get_flow_anomaly_near_misses — HELIX's flow-anomaly near-miss/
// rejection log, distinct from BOTH get_market_regime's committed-anomaly COUNT
// and get_ecosystem_context's per-ticker `recent_anomalies` (both read the
// committed-only flow_anomalies table), and from get_zerodte_rejections (task
// #147, a completely different engine/threshold set). Locks in the disambiguating
// language so a future edit can't quietly drop it and reintroduce the exact
// name-confusion risk task #127 fixed for the 0DTE-flavored tools.

test("get_flow_anomaly_near_misses is a real tool, reachable via TOOL_GROUPS.platform alongside get_market_regime", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_flow_anomaly_near_misses");
  assert.ok(def, "get_flow_anomaly_near_misses must be a registered Largo tool");
  assert.ok(
    TOOL_GROUPS.platform.includes("get_flow_anomaly_near_misses"),
    "get_flow_anomaly_near_misses must be routed via TOOL_GROUPS.platform — Largo would never call it otherwise"
  );
});

test("get_flow_anomaly_near_misses description disambiguates from get_market_regime, get_ecosystem_context, and get_zerodte_rejections", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_flow_anomaly_near_misses");
  assert.ok(def);
  assert.match(
    def!.description,
    /get_ecosystem_context/,
    "expected get_flow_anomaly_near_misses description to reference get_ecosystem_context's committed-only recent_anomalies"
  );
  assert.match(
    def!.description,
    /get_zerodte_rejections/,
    "expected get_flow_anomaly_near_misses description to point away from 0DTE Command's own separate near-miss log"
  );
  assert.match(
    def!.description,
    /BELOW_THRESHOLD/,
    "expected get_flow_anomaly_near_misses description to name the below-threshold reason"
  );
  assert.match(
    def!.description,
    /DEDUP_SUPPRESSED/,
    "expected get_flow_anomaly_near_misses description to name the dedup-suppressed reason, distinctly from BELOW_THRESHOLD"
  );
});

test("get_market_regime description points forward to get_flow_anomaly_near_misses for a candidate that never fired", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_market_regime");
  assert.ok(def);
  assert.match(
    def!.description,
    /get_flow_anomaly_near_misses/,
    "expected get_market_regime to point to get_flow_anomaly_near_misses for anomalies that never cleared the threshold"
  );
});
