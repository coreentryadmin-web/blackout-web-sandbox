import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";

// Deliberately a plain `.ts` file, NOT `.test.ts` — tsconfig.json excludes
// "**/*.test.ts" from `npx tsc --noEmit` (see the exclude list), so a fixture
// typed only INSIDE a *.test.ts file gets zero real compile-time enforcement:
// tsx (esbuild) strips types at test-run time without checking them, and the
// project's own type-check command never looks at test files at all. Any
// type-level "this test proves SpxPlayPayload's shape never silently drifts"
// claim living only in a .test.ts file would be theater, not a real net.
//
// Putting the fixture here instead makes it a normal source file that IS
// covered by `**/*.ts` in tsconfig's include list, so `npx tsc --noEmit`
// actually type-checks this literal against the live SpxPlayPayload type on
// every run (locally and in CI) — not just when a human remembers to.
//
// SPX_FULL_STATE_FIXTURE models every field of the real SpxPlayPayload type
// (spx-play-payload.ts) with a fully valid, realistic value for each nested
// union (ClaudePlayVerdict, PlayConfirmationResult, OptionTicket, MtfHybrid,
// etc.) — not just outer field names. Both excess and missing properties are
// compile errors on a `const x: T = {...}` object literal, so adding,
// removing, or retyping a field on SpxPlayPayload breaks this file's build
// until a human updates it here. src/lib/bie/ecosystem-context.test.ts then
// imports this constant to prove — at RUNTIME, via deepEqual — that
// fetchEcosystemContext()'s spx_full_state field passes every one of these
// fields through untouched from getSpxPlayState() (the same function backing
// Largo's own get_spx_play tool; see ecosystem-context.ts's module doc).
// Together: a compile-time "every field must be modeled" guarantee and a
// runtime "every modeled field survives untouched" guarantee.
//
// Task #124 (SPX Slayer <-> BIE/Largo correctness-validator sweep),
// docs/audit/FINDINGS.md.
export const SPX_FULL_STATE_FIXTURE: SpxPlayPayload = {
  available: true,
  phase: "OPEN",
  action: "HOLD",
  direction: "long",
  grade: "A",
  score: 82,
  confidence: 91,
  headline: "SPX cold buy long, holding above VWAP",
  thesis: "Reclaimed VWAP with EMA20/50 stacked bullish; gamma regime supportive.",
  idle_message: null,
  factors: [{ label: "vwap_reclaim", weight: 12, detail: "Price 5502.3 vs VWAP 5498.1" }],
  levels: { entry: 5500, stop: 5480, target: 5550, invalidation: "Close below 5480" },
  gates: {
    passed: true,
    blocks: [],
    warnings: ["thin_afternoon_liquidity"],
    entry_mode: "cold_buy",
    play_idea: "Cold buy long on VWAP reclaim",
  },
  claude: {
    verdict: "APPROVE_BUY",
    direction: "long",
    headline: "BIE confirms cold buy long",
    thesis: "Grounded in live confluence factors",
    approved: true,
    source: "bie",
  },
  cortex: null,
  open_play: {
    id: 1,
    direction: "long",
    entry_price: 5500,
    stop: 5480,
    target: 5550,
    grade: "A",
    opened_at: "2026-07-04T14:35:00.000Z",
    mfe_pts: 10,
    trim_done: false,
  },
  confirmations: {
    passed: true,
    passed_count: 8,
    total: 10,
    checks: [{ label: "Above VWAP", passed: true, required: true, detail: "Price above VWAP at evaluation time" }],
  },
  technicals: {
    m5_trend: "up",
    m5_rsi: 61.2,
    m5_rsi_warning: null,
    m3_close: 5502.3,
    breakout: {
      pdh_break: false,
      pdl_break: false,
      hod_break: true,
      lod_break: false,
      vwap_reclaim: true,
      vwap_lost: false,
    },
    mtf_summary: "Bullish across 5m/15m/1h",
  },
  mtf: {
    ok: true,
    soft_3m: false,
    soft_5m: false,
    t1_trigger: true,
    t2_confirm_3m: true,
    t3_regime_5m: true,
    failure_reason: null,
    summary: "Bullish across 5m/15m/1h",
  },
  option_ticket: {
    underlying: "SPX",
    strike: 5500,
    option_type: "call",
    contract_label: "SPXW260704C05500000",
    ticker: "O:SPXW260704C05500000",
    bid: 4.3,
    ask: 4.4,
    mid: 4.35,
    spread_pct: 2.3,
    delta: 0.52,
    open_interest: 1200,
    premium_range: "$4.30-$4.40",
    blocked: false,
    block_reason: null,
  },
  watch: { active: false, promote_ready: false, reason: "already in a committed play", since: null },
  telemetry: {
    adaptive_active: true,
    summary: "Cold-buy win rate 61% (n=41)",
    cold_buy_win_rate: 0.61,
    promote_win_rate: null,
    global_score_boost: 2,
    promote_score_boost: 0,
    total_closed: 41,
  },
  lotto_play: null,
  power_play: null,
  session_phase: "cash",
  signal_committed: true,
  as_of: "2026-07-04T14:40:00.000Z",
};
