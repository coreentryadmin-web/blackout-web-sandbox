"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DOCS_PROBE_REPORT } from "@/lib/docs-probe-report";

type ProbeRow = (typeof DOCS_PROBE_REPORT.results)[number];
type StatusFilter = "all" | "ok" | "fail" | "blocked" | "rate_limited";
type UsageFilter = "all" | "used" | "unused";
type ProviderFilter = "all" | "polygon" | "unusual_whales";

function isPolygonProvider(provider: string) {
  return provider.startsWith("polygon");
}

function probeStatus(row: ProbeRow): StatusFilter {
  if (row.probe.ok) return "ok";
  if (row.probe.blocked) return "blocked";
  if (Number(row.probe.status) === 429) return "rate_limited";
  return "fail";
}

function statusLabel(status: StatusFilter) {
  switch (status) {
    case "ok":
      return "OK";
    case "blocked":
      return "Blocked";
    case "rate_limited":
      return "429";
    case "fail":
      return "Fail";
    default:
      return status;
  }
}

function StatusBadge({ status }: { status: StatusFilter }) {
  return <span className={`docs-probe-badge docs-probe-badge-${status}`}>{statusLabel(status)}</span>;
}

export default function LiveProbePage() {
  const { summary, results } = DOCS_PROBE_REPORT;
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");

  const probedAt = useMemo(
    () => new Date(summary.probedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET",
    [summary.probedAt]
  );

  const sections = useMemo(() => {
    const set = new Set<string>();
    for (const row of results) set.add(row.docSection);
    return Array.from(set).sort();
  }, [results]);

  const filtered = useMemo(() => {
    return results.filter((row) => {
      if (providerFilter === "polygon" && !isPolygonProvider(row.provider)) return false;
      if (providerFilter === "unusual_whales" && row.provider !== "unusual_whales") return false;
      if (usageFilter === "used" && !row.usedInCode) return false;
      if (usageFilter === "unused" && row.usedInCode) return false;
      if (sectionFilter !== "all" && row.docSection !== sectionFilter) return false;
      if (statusFilter !== "all" && probeStatus(row) !== statusFilter) return false;
      return true;
    });
  }, [results, providerFilter, usageFilter, statusFilter, sectionFilter]);

  const unusedWorking = useMemo(
    () => results.filter((r) => !r.usedInCode && r.probe.ok),
    [results]
  );

  const usedBlocked = useMemo(
    () => results.filter((r) => r.usedInCode && r.probe.blocked),
    [results]
  );

  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">Blackout · Engineering reference</p>
        <h1 className="docs-title">Live API Probe</h1>
        <p className="docs-lead">
          Live HTTP probe of every endpoint documented in{" "}
          <Link href="/docs/polygon">Polygon</Link> and{" "}
          <Link href="/docs/unusual-whales">Unusual Whales</Link>, cross-checked against codebase
          usage. Last run {probedAt}.
          {"uwDelayMs" in summary && (
            <>
              {" "}
              UW pacing: {String((summary as { uwDelayMs?: number }).uwDelayMs ?? 650)}ms/request.
            </>
          )}
        </p>
        <div className="docs-header-links">
          <Link href="/docs/cursor-api-analysis" className="docs-back-link">
            ← API usage analysis
          </Link>
          <Link href="/docs/polygon" className="docs-back-link">
            Polygon docs →
          </Link>
          <Link href="/docs/unusual-whales" className="docs-back-link">
            UW docs →
          </Link>
        </div>
      </header>

      <section className="docs-section">
        <h2>Summary</h2>
        <div className="docs-analysis-grid">
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.documentedTotal}</span>
            <span className="docs-analysis-label">Documented</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.probedTotal}</span>
            <span className="docs-analysis-label">Probed</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.polygon.ok + summary.unusual_whales.ok}</span>
            <span className="docs-analysis-label">Live OK</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">
              {summary.polygon.unusedAndWorking + summary.unusual_whales.unusedAndWorking}
            </span>
            <span className="docs-analysis-label">Unused + OK</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">
              {summary.polygon.usedInCode + summary.unusual_whales.usedInCode}
            </span>
            <span className="docs-analysis-label">Used in code</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">
              {summary.polygon.blocked + summary.unusual_whales.blocked}
            </span>
            <span className="docs-analysis-label">Plan blocked</span>
          </div>
        </div>

        <div className="docs-probe-provider-cards">
          <div className="docs-probe-card">
            <h3 className="docs-subheading">Polygon / Massive</h3>
            <ul className="docs-probe-metrics">
              <li>
                <span>Total</span> <strong>{summary.polygon.total}</strong>
              </li>
              <li>
                <span>OK</span> <strong>{summary.polygon.ok}</strong>
              </li>
              <li>
                <span>Fail</span> <strong>{summary.polygon.fail}</strong>
              </li>
              <li>
                <span>Used</span> <strong>{summary.polygon.usedInCode}</strong>
              </li>
              <li>
                <span>Unused + OK</span> <strong>{summary.polygon.unusedAndWorking}</strong>
              </li>
            </ul>
          </div>
          <div className="docs-probe-card">
            <h3 className="docs-subheading">Unusual Whales</h3>
            <ul className="docs-probe-metrics">
              <li>
                <span>Total</span> <strong>{summary.unusual_whales.total}</strong>
              </li>
              <li>
                <span>OK</span> <strong>{summary.unusual_whales.ok}</strong>
              </li>
              <li>
                <span>Fail</span> <strong>{summary.unusual_whales.fail}</strong>
              </li>
              {"rateLimited" in summary.unusual_whales && (
                <li>
                  <span>429</span>{" "}
                  <strong>{String((summary.unusual_whales as { rateLimited?: number }).rateLimited ?? 0)}</strong>
                </li>
              )}
              <li>
                <span>Blocked</span> <strong>{summary.unusual_whales.blocked}</strong>
              </li>
              <li>
                <span>Used</span> <strong>{summary.unusual_whales.usedInCode}</strong>
              </li>
              <li>
                <span>Unused + OK</span> <strong>{summary.unusual_whales.unusedAndWorking}</strong>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {usedBlocked.length > 0 && (
        <section className="docs-section">
          <h2>Used in code but blocked ({usedBlocked.length})</h2>
          <p>These endpoints are referenced in <code>src/</code> but returned 401/403 on probe.</p>
          <div className="docs-rest-table-wrap">
            <table className="docs-table docs-rest-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Name</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {usedBlocked.map((row) => (
                  <tr key={`${row.provider}-${row.pathTemplate}-${row.name}`}>
                    <td>{row.provider}</td>
                    <td>{row.name}</td>
                    <td>
                      <code className="docs-rest-path">{row.pathTemplate}</code>
                    </td>
                    <td>{row.probe.status}</td>
                    <td className="docs-probe-note">{row.probe.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="docs-section">
        <h2>Unused but live OK — integration candidates ({unusedWorking.length})</h2>
        <p>Documented endpoints that respond successfully but are not referenced in application code.</p>
        <div className="docs-rest-table-wrap">
          <table className="docs-table docs-rest-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Section</th>
                <th>Name</th>
                <th>Path</th>
                <th>ms</th>
              </tr>
            </thead>
            <tbody>
              {unusedWorking.map((row) => (
                <tr key={`${row.provider}-${row.pathTemplate}-${row.name}`}>
                  <td>{row.provider}</td>
                  <td>{row.docSection}</td>
                  <td>{row.name}</td>
                  <td>
                    <code className="docs-rest-path">{row.pathTemplate}</code>
                  </td>
                  <td className="docs-probe-ms">{row.probe.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="docs-section" id="all-results">
        <h2>All probe results ({filtered.length})</h2>
        <div className="docs-probe-filters">
          <div className="docs-provider-tabs">
            {(["all", "polygon", "unusual_whales"] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={providerFilter === p ? "docs-provider-tab-active" : "docs-provider-tab"}
                onClick={() => setProviderFilter(p)}
              >
                {p === "all" ? "All" : p === "polygon" ? "Polygon" : "UW"}
              </button>
            ))}
          </div>
          <div className="docs-provider-tabs">
            {(["all", "used", "unused"] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={usageFilter === u ? "docs-provider-tab-active" : "docs-provider-tab"}
                onClick={() => setUsageFilter(u)}
              >
                {u}
              </button>
            ))}
          </div>
          <div className="docs-provider-tabs">
            {(["all", "ok", "fail", "blocked", "rate_limited"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={statusFilter === s ? "docs-provider-tab-active" : "docs-provider-tab"}
                onClick={() => setStatusFilter(s)}
              >
                {s === "rate_limited" ? "429" : s}
              </button>
            ))}
          </div>
          <label className="docs-probe-select-wrap">
            <span>Section</span>
            <select
              className="docs-probe-select"
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
            >
              <option value="all">All sections</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="docs-rest-table-wrap">
          <table className="docs-table docs-rest-table docs-probe-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Usage</th>
                <th>Provider</th>
                <th>Section</th>
                <th>Name</th>
                <th>Path</th>
                <th>HTTP</th>
                <th>ms</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={`${row.provider}-${row.pathTemplate}-${row.name}`}>
                  <td>
                    <StatusBadge status={probeStatus(row)} />
                  </td>
                  <td>
                    <span
                      className={
                        row.usedInCode ? "docs-probe-usage-used" : "docs-probe-usage-unused"
                      }
                    >
                      {row.usedInCode ? "used" : "unused"}
                    </span>
                  </td>
                  <td className="docs-probe-provider">{row.provider}</td>
                  <td>{row.docSection}</td>
                  <td>{row.name}</td>
                  <td>
                    <code className="docs-rest-path">{row.pathTemplate}</code>
                  </td>
                  <td className="docs-probe-ms">{row.probe.status || "—"}</td>
                  <td className="docs-probe-ms">{row.probe.ms}</td>
                  <td className="docs-probe-note">{row.probe.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="docs-section">
        <h2>Regenerate</h2>
        <pre className="docs-code">{`# Full probe (Polygon + UW)
node scripts/analyze-api-usage.mjs
node scripts/probe-docs-endpoints.mjs

# Re-probe UW only (650ms pacing, merges prior Polygon results)
node scripts/probe-docs-endpoints.mjs --uw-only

# Output: src/lib/docs-probe-report.json + docs-probe-report.ts
# View:   /docs/cursor-api-analysis/live-probe`}</pre>
      </section>
    </main>
  );
}
