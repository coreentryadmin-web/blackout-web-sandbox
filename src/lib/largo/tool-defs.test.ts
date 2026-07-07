import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIE_TOOL_NAMES,
  getToolsForIntent,
  HELIX_ENGINE_TOOL_NAMES,
  LARGO_TOOL_DEFS,
  MARKET_ENGINE_TOOL_NAMES,
  NIGHTHAWK_ENGINE_TOOL_NAMES,
  SPX_ENGINE_TOOL_NAMES,
  THERMAL_ENGINE_TOOL_NAMES,
  TOOL_GROUPS,
  ZERODTE_ENGINE_TOOL_NAMES,
} from "./tool-defs";

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

// ── Task #133: HELIX_ENGINE_TOOL_NAMES (calibration.ts's HELIX-tool-calling cohort) ──

test("HELIX_ENGINE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of HELIX_ENGINE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in HELIX_ENGINE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("HELIX_ENGINE_TOOL_NAMES: every name is a subset of TOOL_GROUPS.spx_desk, flow_analysis, or platform", () => {
  // get_flow_tape lives in spx_desk (bundled there for SPX-flavored routing
  // convenience, per SPX_ENGINE_TOOL_NAMES's own doc comment above) and
  // get_flow_anomaly_near_misses lives in platform — neither lives in
  // flow_analysis itself, so the subset check spans all three groups Largo
  // actually routes tools through.
  const bundle = new Set<string>([...TOOL_GROUPS.spx_desk, ...TOOL_GROUPS.flow_analysis, ...TOOL_GROUPS.platform]);
  for (const name of HELIX_ENGINE_TOOL_NAMES) {
    assert.ok(
      bundle.has(name),
      `${name} is in HELIX_ENGINE_TOOL_NAMES but not in TOOL_GROUPS.spx_desk/flow_analysis/platform — the cohort must stay a NARROWING of tools Largo can actually reach, never wander outside it`
    );
  }
});

test("HELIX_ENGINE_TOOL_NAMES: excludes the generic ticker-scoped flow_analysis tools that hit ANY-ticker UW providers", () => {
  // These take a ticker input and hit the same generic UW providers used for ANY
  // ticker (see run-tool.ts's fetchUw* case bodies) — a turn calling only these
  // says nothing about HELIX-tape/anomaly-detector answer quality specifically.
  for (const generic of [
    "get_options_flow",
    "get_global_flow",
    "get_dark_pool",
    "get_nope",
    "get_flow_per_strike",
    "get_flow_expiry_breakdown",
    "get_net_prem_ticks",
    "get_postgres_flows",
    "get_lit_flow",
    "get_unusual_trades",
    "get_market_oi_change",
    "get_etf_flow",
    "get_market_stats",
    "get_option_contract",
  ]) {
    assert.ok(
      !HELIX_ENGINE_TOOL_NAMES.includes(generic),
      `${generic} is generic/ticker-scoped (or, for get_postgres_flows, unbranded as HELIX's own object) and should not be in the HELIX-engine-state cohort`
    );
  }
});

test("HELIX_ENGINE_TOOL_NAMES: excludes the BIE-authored cross-product tools and get_platform_snapshot", () => {
  // Same reasoning SPX_ENGINE_TOOL_NAMES gives for excluding get_ecosystem_context:
  // these are callable for ANY ticker or span multiple products, and
  // bie_interactions.tools_used records only tool NAMES, never call inputs.
  for (const crossProduct of [...BIE_TOOL_NAMES, "get_platform_snapshot"]) {
    assert.ok(
      !HELIX_ENGINE_TOOL_NAMES.includes(crossProduct),
      `${crossProduct} is a cross-product tool and should not be in the HELIX-engine-state cohort`
    );
  }
});

test("HELIX_ENGINE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(HELIX_ENGINE_TOOL_NAMES).size, HELIX_ENGINE_TOOL_NAMES.length);
});

// ── Task #137: THERMAL_ENGINE_TOOL_NAMES (calibration.ts's Thermal-tool-calling cohort) ──

test("THERMAL_ENGINE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of THERMAL_ENGINE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in THERMAL_ENGINE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("THERMAL_ENGINE_TOOL_NAMES: every name is a subset of TOOL_GROUPS.stock_analysis", () => {
  for (const name of THERMAL_ENGINE_TOOL_NAMES) {
    assert.ok(
      (TOOL_GROUPS.stock_analysis as readonly string[]).includes(name),
      `${name} is in THERMAL_ENGINE_TOOL_NAMES but not in TOOL_GROUPS.stock_analysis — the cohort must stay a NARROWING of the bundle, never wander outside it`
    );
  }
});

test("THERMAL_ENGINE_TOOL_NAMES: excludes get_gex — verified via run-tool.ts that it never reads Thermal's own heatmap/positioning cache", () => {
  // get_gex is the naming trap here: "the GEX tool" for "the GEX product," but its
  // run-tool.ts implementation reads SPX Slayer's own live desk (SPX ticker, today's
  // expiry) or a THIRD, separate spot-keyed 0DTE-desk bundle/raw UW fallback for
  // every other case — never fetchGexHeatmap/getGexPositioning, Thermal's actual
  // shared cache. See THERMAL_ENGINE_TOOL_NAMES's own doc comment for the full trace.
  assert.ok(
    !THERMAL_ENGINE_TOOL_NAMES.includes("get_gex"),
    "get_gex never reads Thermal's own gex-heatmap cache and should not be in the Thermal-engine-state cohort"
  );
});

test("THERMAL_ENGINE_TOOL_NAMES: excludes the generic per-ticker options-chain tools bundled into stock_analysis for convenience", () => {
  // These independently fetch+compute over a raw options chain for whatever
  // ticker/expiry was asked — generic chain/greeks shape, not a read of Thermal's
  // own shared positioning cache.
  for (const generic of ["get_options_chain", "get_oi_per_strike", "get_max_pain", "get_greeks", "get_atm_chains", "get_options_volume"]) {
    assert.ok(
      !THERMAL_ENGINE_TOOL_NAMES.includes(generic),
      `${generic} is a generic per-ticker options-chain tool and should not be in the Thermal-engine-state cohort`
    );
  }
});

test("THERMAL_ENGINE_TOOL_NAMES: excludes get_ecosystem_context — cross-product, any-ticker, tools_used can't disambiguate scope", () => {
  assert.ok(
    !(THERMAL_ENGINE_TOOL_NAMES as readonly string[]).includes("get_ecosystem_context"),
    "get_ecosystem_context is cross-product/any-ticker and should not be in the Thermal-engine-state cohort"
  );
});

test("THERMAL_ENGINE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(THERMAL_ENGINE_TOOL_NAMES).size, THERMAL_ENGINE_TOOL_NAMES.length);
});

// ── Task #144: NIGHTHAWK_ENGINE_TOOL_NAMES (calibration.ts's Night-Hawk-tool-calling
// cohort) — same-shaped analogue of SPX_ENGINE_TOOL_NAMES above, for Night Hawk. ──

test("NIGHTHAWK_ENGINE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of NIGHTHAWK_ENGINE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in NIGHTHAWK_ENGINE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("NIGHTHAWK_ENGINE_TOOL_NAMES: every name is a subset of TOOL_GROUPS.platform", () => {
  for (const name of NIGHTHAWK_ENGINE_TOOL_NAMES) {
    assert.ok(
      (TOOL_GROUPS.platform as readonly string[]).includes(name),
      `${name} is in NIGHTHAWK_ENGINE_TOOL_NAMES but not in TOOL_GROUPS.platform — the cohort must stay a NARROWING of the platform bundle, never wander outside it`
    );
  }
});

test("NIGHTHAWK_ENGINE_TOOL_NAMES: excludes the two cross-product/ambiguous-scope Night-Hawk-adjacent tools", () => {
  // get_spx_vs_nighthawk_comparison always reads BOTH products' state (conflates,
  // doesn't narrow); get_platform_snapshot's tools_used entry can't reveal whether
  // its `include` actually touched the nighthawk slice at all. See the doc comment
  // on NIGHTHAWK_ENGINE_TOOL_NAMES in tool-defs.ts for the full reasoning.
  for (const excluded of ["get_spx_vs_nighthawk_comparison", "get_platform_snapshot"]) {
    assert.ok(
      !NIGHTHAWK_ENGINE_TOOL_NAMES.includes(excluded),
      `${excluded} should not be in the Night-Hawk-engine-state cohort`
    );
  }
});

test("NIGHTHAWK_ENGINE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(NIGHTHAWK_ENGINE_TOOL_NAMES).size, NIGHTHAWK_ENGINE_TOOL_NAMES.length);
});

// ── Task #149: ZERODTE_ENGINE_TOOL_NAMES (calibration.ts's 0DTE-Command-tool-calling cohort) ──

test("ZERODTE_ENGINE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of ZERODTE_ENGINE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in ZERODTE_ENGINE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("ZERODTE_ENGINE_TOOL_NAMES: every name is a subset of TOOL_GROUPS.platform", () => {
  for (const name of ZERODTE_ENGINE_TOOL_NAMES) {
    assert.ok(
      (TOOL_GROUPS.platform as readonly string[]).includes(name),
      `${name} is in ZERODTE_ENGINE_TOOL_NAMES but not in TOOL_GROUPS.platform — the cohort must stay a NARROWING of the platform bundle, never wander outside it`
    );
  }
});

test("ZERODTE_ENGINE_TOOL_NAMES: is exactly the 0DTE Command pair — get_zerodte_plays and get_zerodte_rejections", () => {
  assert.deepEqual(new Set(ZERODTE_ENGINE_TOOL_NAMES), new Set(["get_zerodte_plays", "get_zerodte_rejections"]));
});

test("ZERODTE_ENGINE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(ZERODTE_ENGINE_TOOL_NAMES).size, ZERODTE_ENGINE_TOOL_NAMES.length);
});

// ── Task #161: MARKET_ENGINE_TOOL_NAMES (calibration.ts's market-context-tool-calling
// cohort) — market_context is the FOURTH of BIE's deterministic router intents
// (zerodte_plays/ticker_play_state/spx_structure/market_context) and, until this task,
// the only one without its own tool-calling cohort. ──

test("MARKET_ENGINE_TOOL_NAMES: every name is a real, callable Largo tool", () => {
  const known = new Set(LARGO_TOOL_DEFS.map((t) => t.name));
  for (const name of MARKET_ENGINE_TOOL_NAMES) {
    assert.ok(known.has(name), `${name} is in MARKET_ENGINE_TOOL_NAMES but not in LARGO_TOOL_DEFS`);
  }
});

test("MARKET_ENGINE_TOOL_NAMES: every name is a subset of TOOL_GROUPS.vol_analysis, where get_market_context itself lives", () => {
  for (const name of MARKET_ENGINE_TOOL_NAMES) {
    assert.ok(
      (TOOL_GROUPS.vol_analysis as readonly string[]).includes(name),
      `${name} is in MARKET_ENGINE_TOOL_NAMES but not in TOOL_GROUPS.vol_analysis — the cohort must stay a NARROWING of the bundle it's routed through, never wander outside it`
    );
  }
});

test("MARKET_ENGINE_TOOL_NAMES: is exactly the single-tool list — get_market_context, the one tool composeMarketContext reads", () => {
  assert.deepEqual(new Set(MARKET_ENGINE_TOOL_NAMES), new Set(["get_market_context"]));
});

test("MARKET_ENGINE_TOOL_NAMES: excludes get_market_regime — a cross-product BIE tool that reads a completely different backend (fetchPlatformIntelSnapshot), not composeMarketContext's state", () => {
  // Same reasoning HELIX_ENGINE_TOOL_NAMES's own doc comment gives for excluding
  // get_market_regime from ITS list: it's a BIE_TOOL_NAMES member precisely
  // because it's callable regardless of which product's question is being asked,
  // and bie_interactions.tools_used records only tool NAMES, never call scope.
  assert.ok(
    !(MARKET_ENGINE_TOOL_NAMES as readonly string[]).includes("get_market_regime"),
    "get_market_regime reads platform-wide regime intel, not market_context's own composed state, and should not be in this cohort"
  );
});

test("MARKET_ENGINE_TOOL_NAMES: no duplicates", () => {
  assert.equal(new Set(MARKET_ENGINE_TOOL_NAMES).size, MARKET_ENGINE_TOOL_NAMES.length);
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

// ── Task #130: 4 overlapping Largo flow tools (get_postgres_flows, get_flow_tape,
// get_options_flow, get_global_flow) had thin, non-disambiguating descriptions, and
// get_options_flow's "UW ONLY... No Polygon equivalent" claim was factually stale —
// its own run-tool.ts implementation merges 48h of HELIX/Postgres data
// (helix_session_alerts) for non-SPX tickers. Locks in that each rewritten
// description states its real data source and points at the other 3 by name, so a
// future edit can't silently regress back to thin one-liners.

function flowDef(name: string) {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === name);
  assert.ok(def, `${name} must be a registered Largo tool`);
  return def!;
}

test("get_options_flow description no longer claims UW-only/no-Polygon-equivalent without qualification, and documents the real HELIX merge", () => {
  const def = flowDef("get_options_flow");
  assert.match(def.description, /HELIX/, "expected the description to name HELIX as a real data source");
  assert.match(def.description, /Postgres/, "expected the description to say part of the merged data comes from Postgres");
  assert.match(def.description, /helix_session_alerts/, "expected the description to name the actual response field that reveals HELIX contribution");
  assert.match(def.description, /not\b.*purely UW-only|NOT purely UW-only/i, "expected an explicit correction that this is not purely UW-only data for non-SPX tickers");
  assert.match(def.description, /REQUIRES a ticker/);
});

test("get_options_flow, get_global_flow, get_flow_tape, get_postgres_flows descriptions each name the other 3 tools for disambiguation", () => {
  const names = ["get_options_flow", "get_global_flow", "get_flow_tape", "get_postgres_flows"];
  for (const name of names) {
    const def = flowDef(name);
    const others = names.filter((n) => n !== name);
    for (const other of others) {
      assert.match(def.description, new RegExp(other), `expected ${name}'s description to reference ${other} for disambiguation`);
    }
  }
});

test("get_flow_tape description documents it is a strict superset of get_postgres_flows (same underlying fetch, plus aggregates)", () => {
  const def = flowDef("get_flow_tape");
  assert.match(def.description, /superset|SUPERSET/, "expected get_flow_tape to state the superset relationship");
  assert.match(def.description, /top_tickers/);
  assert.match(def.description, /total_premium/);
});

test("get_postgres_flows description documents it is the subset get_flow_tape's `recent` field mirrors", () => {
  const def = flowDef("get_postgres_flows");
  assert.match(def.description, /superset|SUPERSET/, "expected get_postgres_flows to state the superset relationship (from its side)");
  assert.match(def.description, /recent/, "expected reference to get_flow_tape's `recent` field");
});

test("get_global_flow description accurately keeps the UW-only/no-Postgres-merge claim (this one genuinely has no HELIX merge)", () => {
  const def = flowDef("get_global_flow");
  assert.match(def.description, /UW ONLY/);
  assert.match(def.description, /no Postgres\/HELIX merge|no Postgres merge/i);
});

test("get_options_flow and get_global_flow both document strike_stacks; get_flow_tape and get_postgres_flows both document they do NOT compute it", () => {
  assert.match(flowDef("get_options_flow").description, /strike_stacks/);
  assert.match(flowDef("get_global_flow").description, /strike_stacks/);
  assert.match(flowDef("get_flow_tape").description, /no strike_stacks/i);
  assert.match(flowDef("get_postgres_flows").description, /no strike_stacks/i);
});

test("'flows'/'flowing' phrasing puts get_options_flow/get_global_flow/get_postgres_flows on the allowlist (FLOW_TOOLS_RE plural/gerund gap)", () => {
  for (const question of ["any options flows building up today", "what's flowing on the tape lately"]) {
    const tools = getToolsForIntent(question);
    for (const name of ["get_options_flow", "get_global_flow", "get_postgres_flows", "get_flow_tape"]) {
      assert.ok(tools.includes(name), `expected ${name} on the allowlist for: "${question}"`);
    }
  }
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

// ── Task #143: get_nighthawk_edition vs get_platform_snapshot ──
// Both tools could answer a Night-Hawk-flavored question, but only one of them
// (get_nighthawk_edition) always returns full play detail and supports a `date`
// param for a specific past edition — get_platform_snapshot's own nighthawk field
// is a stripped summary by default, and even with full_edition:true it can only
// ever return the LATEST published edition. Neither description said so before
// this fix. Locks in the disambiguating language so a future edit can't quietly
// drop it and reintroduce the "wrong tool → incomplete or wrong-date answer" risk.

function nighthawkDef(name: string) {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === name);
  assert.ok(def, `${name} must be a registered Largo tool`);
  return def!;
}

test("get_nighthawk_edition description documents the full play-level fields and the date param's unique capability", () => {
  const def = nighthawkDef("get_nighthawk_edition");
  for (const field of ["thesis", "entry_range", "target", "stop", "score"]) {
    assert.match(def.description, new RegExp(field), `expected get_nighthawk_edition to document the \`${field}\` play field`);
  }
  assert.match(
    def.description,
    /ONLY Night Hawk tool that can do that/,
    "expected get_nighthawk_edition to state that its `date` param is uniquely its own"
  );
  assert.match(
    def.description,
    /get_platform_snapshot/,
    "expected get_nighthawk_edition to reference get_platform_snapshot for disambiguation"
  );
  assert.match(
    def.description,
    /STRIPPED SUMMARY/,
    "expected get_nighthawk_edition to characterize get_platform_snapshot's default nighthawk field as a stripped summary"
  );
});

test("get_platform_snapshot description documents the default slim nighthawk summary, full_edition's scope, and the latest-only limitation", () => {
  const def = nighthawkDef("get_platform_snapshot");
  assert.match(
    def.description,
    /STRIPPED-DOWN summary ONLY/,
    "expected get_platform_snapshot to state its nighthawk field is a stripped-down summary by default"
  );
  assert.match(
    def.description,
    /ALWAYS the LATEST published edition/,
    "expected get_platform_snapshot to state full_edition never serves anything but the latest edition"
  );
  assert.match(
    def.description,
    /no date parameter/,
    "expected get_platform_snapshot to explicitly state it has no date parameter"
  );
  assert.match(
    def.description,
    /get_nighthawk_edition/,
    "expected get_platform_snapshot to reference get_nighthawk_edition for disambiguation"
  );
});

test("get_nighthawk_edition and get_platform_snapshot both name the exact fields that distinguish full detail from a summary", () => {
  const edition = nighthawkDef("get_nighthawk_edition");
  const snapshot = nighthawkDef("get_platform_snapshot");
  // Both descriptions must agree on the same "what's missing from the summary"
  // vocabulary so a reader of either one gets the same disambiguating signal.
  for (const field of ["thesis", "entry", "target", "stop", "score"]) {
    assert.match(edition.description, new RegExp(field, "i"), `expected get_nighthawk_edition to name \`${field}\` as a real play field`);
    assert.match(snapshot.description, new RegExp(field, "i"), `expected get_platform_snapshot to name \`${field}\` as missing from its summary`);
  }
});

test("get_platform_snapshot documents that its spx/flows fields are the exact same objects get_spx_structure/get_flow_tape return", () => {
  const def = nighthawkDef("get_platform_snapshot");
  assert.match(def.description, /get_spx_structure returns/);
  assert.match(def.description, /get_flow_tape returns/);
});

test("get_platform_snapshot documents that its 'largo' include option is currently a no-op", () => {
  const def = nighthawkDef("get_platform_snapshot");
  assert.match(def.description, /'largo'.*no-op|no-op.*'largo'/is);
});

// ── Task #143: NIGHTHAWK_RE's "edition" gap ──
// The live /nighthawk UI renders "Edition live"/"Prior edition" as its own
// primary vocabulary, but NIGHTHAWK_RE had no "edition"/"editions" token at all —
// a plainly on-topic question phrased that way got NIGHTHAWK_RE: false, dropped
// TOOL_GROUPS.platform (get_nighthawk_edition, get_platform_snapshot, and every
// other Night-Hawk/platform tool) out of the turn's tool allowlist entirely, and
// fell back to getToolsForIntent's `names.size <= 2` branch, which dumps the
// entire unrelated CORE_TOOLS bundle instead (same class of bug task #130 found
// for FLOW_RE's missing "flows"/"flowing" siblings).

test("bare 'edition' wording (no nighthawk/hawk/playbook token) puts get_nighthawk_edition and get_platform_snapshot on the allowlist", () => {
  for (const question of [
    "is a new edition live yet",
    "what's in tonight's edition",
    "show me last night's edition",
  ]) {
    const tools = getToolsForIntent(question);
    assert.ok(tools.includes("get_nighthawk_edition"), `expected get_nighthawk_edition on the allowlist for: "${question}"`);
    assert.ok(tools.includes("get_platform_snapshot"), `expected get_platform_snapshot on the allowlist for: "${question}"`);
  }
});

// ── Task #140: generic (ticker-independent) dealer-positioning/GEX wording ──
// SPX_DESK_TOOLS_RE's bare "gamma"/"gex"/"dealer" tokens already route these
// questions to TOOL_GROUPS.spx_desk (get_gex, get_gex_regime_events), but that
// match also means getToolsForIntent's `names.size <= 2` CORE_TOOLS fallback
// (the only other path that would have pulled in TOOL_GROUPS.stock_analysis)
// never fires — so get_positioning, the one tool whose own description says it
// answers "dealer positioning for ANY ticker," was unreachable for exactly the
// ticker-less questions that most clearly ask for it. Locks in the fix so a
// future edit to SPX_DESK_TOOLS_RE, GEX_POSITIONING_RE, or TOOL_GROUPS.spx_desk
// can't silently reopen this gap.

test("generic ticker-less dealer-positioning/GEX wording puts get_positioning on the allowlist", () => {
  for (const question of [
    "what's dealer positioning look like",
    "where's the gamma flip",
    "show me the GEX walls",
    "what's the call wall and put wall",
    "is dealer gamma positive or negative",
    "what's the current gamma regime",
    "is the market showing negative gamma",
    "what's net gex right now",
  ]) {
    const tools = getToolsForIntent(question);
    assert.ok(tools.includes("get_positioning"), `expected get_positioning on the allowlist for: "${question}"`);
    // The pre-existing GEX-snapshot tools this same wording already reached
    // before this fix must still be present — this is an addition, not a swap.
    assert.ok(tools.includes("get_gex"), `expected get_gex on the allowlist for: "${question}"`);
    assert.ok(tools.includes("get_gex_regime_events"), `expected get_gex_regime_events on the allowlist for: "${question}"`);
  }
});

test("unrelated 0DTE/play-state wording does NOT spuriously add get_positioning", () => {
  // Sanity check against over-routing: bare 0dte/play-board wording matches a
  // different branch (spx_desk only, never GEX_POSITIONING_RE) and should stay
  // exactly that — adding get_positioning here would be the false-positive
  // over-routing this fix is explicitly trying to avoid.
  const tools = getToolsForIntent("how are today's plays doing");
  assert.ok(!tools.includes("get_positioning"), "bare 0DTE/play-board wording should not add get_positioning");
});
