import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMissedAlertWindows, ALERT_PRODUCING_CRON_KEYS, type MissedAlertCronJob } from "./missed-alerts";
import { CRON_JOBS } from "@/lib/cron-registry";

function job(overrides: Partial<MissedAlertCronJob>): MissedAlertCronJob {
  return { key: "flow-ingest", status: "healthy", status_label: "OK", market_hours_stale: false, ...overrides };
}

test("detectMissedAlertWindows: flags an alert-producing cron that is currently stale during RTH", () => {
  const jobs = [job({ key: "spx-evaluate", status: "stale", status_label: "No run in 40m", market_hours_stale: true })];
  assert.deepEqual(detectMissedAlertWindows(jobs), {
    outage_count: 1,
    windows: [{ job_key: "spx-evaluate", status: "stale", status_label: "No run in 40m" }],
  });
});

test("detectMissedAlertWindows: flags a failed alert-producing cron even if not market_hours_stale", () => {
  const jobs = [job({ key: "gex-alerts", status: "failed", status_label: "Last run failed", market_hours_stale: false })];
  assert.deepEqual(detectMissedAlertWindows(jobs), {
    outage_count: 1,
    windows: [{ job_key: "gex-alerts", status: "failed", status_label: "Last run failed" }],
  });
});

test("detectMissedAlertWindows: ignores a cache-warming cron even if it is market_hours_stale", () => {
  // Regression: grid-warm/heatmap-warm are market-hours-only cache
  // warmers, not alert producers -- their downtime degrades latency, it does not mean
  // a real setup went unevaluated.
  const jobs = [job({ key: "grid-warm", status: "stale", status_label: "No run in 20m", market_hours_stale: true })];
  assert.deepEqual(detectMissedAlertWindows(jobs), { outage_count: 0, windows: [] });
});

test("detectMissedAlertWindows: ignores an alert-producing cron that is merely stale off-hours (not market_hours_stale)", () => {
  const jobs = [job({ key: "spx-evaluate", status: "stale", status_label: "No run in 500m", market_hours_stale: false })];
  assert.deepEqual(detectMissedAlertWindows(jobs), { outage_count: 0, windows: [] });
});

test("detectMissedAlertWindows: healthy alert-producing crons produce no windows", () => {
  const jobs = [job({ key: "flow-ingest" }), job({ key: "spx-evaluate" }), job({ key: "gex-alerts" })];
  assert.deepEqual(detectMissedAlertWindows(jobs), { outage_count: 0, windows: [] });
});

test("detectMissedAlertWindows: empty job list is safe", () => {
  assert.deepEqual(detectMissedAlertWindows([]), { outage_count: 0, windows: [] });
});

test("ALERT_PRODUCING_CRON_KEYS: derived from the registry, includes every produces_member_alert cron", () => {
  // Regression: this was a hand-maintained 3-entry list that omitted nighthawk-morning-confirm
  // (writes a member-visible UI badge status exactly like the three originally listed crons)
  // with no test cross-checking it against the registry. Deriving it means a future cron with
  // produces_member_alert:true can never again go unmonitored by construction.
  const expected = CRON_JOBS.filter((j) => j.produces_member_alert).map((j) => j.key);
  assert.deepEqual([...ALERT_PRODUCING_CRON_KEYS].sort(), [...expected].sort());
  assert.ok(ALERT_PRODUCING_CRON_KEYS.includes("nighthawk-morning-confirm"));
  assert.ok(ALERT_PRODUCING_CRON_KEYS.length >= 4);
});
