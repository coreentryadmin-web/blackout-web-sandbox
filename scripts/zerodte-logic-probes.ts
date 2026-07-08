/**
 * Pure 0DTE invariant probes — invoked by scripts/zerodte-logic-audit.mjs via tsx.
 * Prints JSON array of { name, status, detail }.
 */
import {
  deriveZeroDteSetups,
  SETUP_MIN_GROSS,
  SETUP_MIN_DOMINANCE,
  SETUP_MIN_AGGR_SHARE,
  SETUP_MAX_ITM_PCT,
  sessionHeat,
  computeLedgerGrade,
  buildZeroDteAuditRow,
  enrichSetup,
} from "../src/lib/zerodte/board";
import {
  buildContractPlan,
  derivePlayStatus,
  gradePlanFromBars,
  NEW_PLAY_CUTOFF_ET_MINUTES,
  PLAN_RULES,
} from "../src/lib/zerodte/plan";
import { mergePlays } from "../src/features/nighthawk/components/ZeroDteBoard";

type Check = { name: string; status: "PASS" | "FAIL"; detail?: string };
const checks: Check[] = [];
const rec = (name: string, status: "PASS" | "FAIL", detail?: string) => {
  checks.push({ name, status, detail });
};

const rows = [
  {
    ticker: "NVDA",
    premium: 2_000_000,
    option_type: "call",
    strike: 140,
    expiry: "2026-07-07",
    dte: 0,
    ask_pct: 70,
    underlying_price: 138,
    fill_price: 2.5,
    open_interest: 1000,
    alerted_at: new Date().toISOString(),
  },
];
const setups = deriveZeroDteSetups(rows, { todayYmd: "2026-07-07" });
if (setups.length !== 1) {
  rec("logic:gate-funnel", "FAIL", `expected 1 setup, got ${setups.length}`);
} else {
  const s = setups[0]!;
  const ok =
    s.gross_premium >= SETUP_MIN_GROSS &&
    (s.aggression ?? 0) >= SETUP_MIN_AGGR_SHARE &&
    s.side_dominance >= SETUP_MIN_DOMINANCE &&
    (s.otm_pct == null || s.otm_pct >= -SETUP_MAX_ITM_PCT);
  rec("logic:gate-funnel", ok ? "PASS" : "FAIL", `${s.ticker} score=${s.score}`);
}

const enriched = enrichSetup(setups[0]!, null);
const audit = buildZeroDteAuditRow(enriched, "2026-07-07");
const failedTrace = audit.decision_trace.filter((t) => !t.passed);
rec(
  "logic:audit-trace",
  failedTrace.length === 0 ? "PASS" : "FAIL",
  failedTrace.map((t) => t.check).join(", ") || "all gates pass"
);

const plan = buildContractPlan({
  occ: "NVDA260707C00140000",
  direction: "long",
  price: 138,
  flowAvgFill: 4.2,
  bid: 4.0,
  ask: 4.4,
  mark: 4.2,
  keySupports: [135],
  keyResistances: [142],
  vwap: 137.5,
});
const stopOk = plan.stop_premium === Math.round(4.2 * 0.5 * 100) / 100;
const targetOk = plan.target_premium === Math.round(4.2 * 2 * 100) / 100;
rec("logic:plan-exits", stopOk && targetOk ? "PASS" : "FAIL", `stop=${plan.stop_premium} target=${plan.target_premium}`);

const open = derivePlayStatus({ entryPremium: 4.2, mark: 4.1, peak: 4.1, trough: 4.0, nowEtMinutes: 11 * 60 });
const trim = derivePlayStatus({ entryPremium: 4.2, mark: 6.0, peak: 8.5, trough: 4.0, nowEtMinutes: 13 * 60 });
const closed = derivePlayStatus({ entryPremium: 4.2, mark: 2.0, peak: 4.4, trough: 2.0, nowEtMinutes: 13 * 60 });
const timeStop = derivePlayStatus({
  entryPremium: 4.2,
  mark: 4.8,
  peak: 4.8,
  trough: 4.0,
  nowEtMinutes: PLAN_RULES.time_stop_et_minutes + 1,
});
rec(
  "logic:play-lifecycle",
  open.status === "OPEN" && trim.status === "TRIM" && closed.status === "CLOSED" && timeStop.status === "CLOSED"
    ? "PASS"
    : "FAIL",
  `${open.status}/${trim.status}/${closed.status}/${timeStop.status}`
);

const T0 = Date.parse("2026-07-07T14:00:00.000Z");
const MIN = 60_000;
const bar = (tOff: number, h: number, l: number, c: number) => ({ t: T0 + tOff * MIN, h, l, c });
const both = gradePlanFromBars([bar(0, 9.0, 2.0, 5.0)], 4.2, T0 - MIN);
rec("logic:plan-grade-stop-first", both.outcome === "stopped" ? "PASS" : "FAIL", both.outcome);

const rth = sessionHeat(14 * 60 + 30, true);
const ph = sessionHeat(NEW_PLAY_CUTOFF_ET_MINUTES, true);
rec("logic:session-heat", rth.state === "RTH" && ph.state === "POWER_HOUR" ? "PASS" : "FAIL", `${rth.state}→${ph.state}`);

const grade = computeLedgerGrade("long", 100, 105);
rec("logic:ledger-grade", grade.direction_hit === true && grade.move_pct === 5 ? "PASS" : "FAIL", `${grade.move_pct}%`);

const mergedLate = mergePlays(
  [{ ...enriched, ticker: "TSLA", direction: "long", top_strike: 250, score: 80, spike: false, plan: { ...plan, entry_status: "IN_RANGE" as const, illiquid: false } }],
  [],
  "POWER_HOUR"
);
rec("logic:merge-past-cutoff", mergedLate[0]?.status === "SKIP" ? "PASS" : "FAIL", mergedLate[0]?.status ?? "empty");

const mergedMoved = mergePlays(
  [{ ...enriched, ticker: "AMD", direction: "long", top_strike: 180, score: 75, spike: false, plan: { ...plan, entry_status: "MOVED" as const, illiquid: false } }],
  [],
  "RTH"
);
rec("logic:merge-moved-skip", mergedMoved[0]?.status === "SKIP" ? "PASS" : "FAIL", mergedMoved[0]?.status ?? "empty");

console.log(JSON.stringify(checks));
