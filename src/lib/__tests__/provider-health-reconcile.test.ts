import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
  buildProviderHealthIssues,
} from "@/lib/provider-health-issues";

describe("buildProviderHealthIssues", () => {
  it("opens critical when failures exceed crit threshold", () => {
    const issues = buildProviderHealthIssues([
      { provider: "uw", calls: 20, failures: 16, rate_limits: 0, top_endpoints: ["/flow"] },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "critical");
    assert.match(issues[0].title, /uw upstream failures/i);
  });

  it("opens warning on elevated fail rate", () => {
    const issues = buildProviderHealthIssues(
      [{ provider: "polygon", calls: 10, failures: 2, rate_limits: 0, top_endpoints: ["/v2/aggs"] }],
      { ...DEFAULT_PROVIDER_HEALTH_THRESHOLDS, failWarn: 5, failCrit: 20, rateWarnPct: 0.15, minCallsForRate: 10 }
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
  });

  it("returns empty when telemetry is clean", () => {
    const issues = buildProviderHealthIssues([
      { provider: "uw", calls: 50, failures: 0, rate_limits: 0, top_endpoints: [] },
    ]);
    assert.equal(issues.length, 0);
  });

  it("flags sustained rate limits separately", () => {
    const issues = buildProviderHealthIssues([
      { provider: "uw", calls: 30, failures: 0, rate_limits: 4, top_endpoints: [] },
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].title, /rate limits/i);
  });
});
