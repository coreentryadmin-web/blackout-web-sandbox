"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CURSOR_API_ANALYSIS } from "@/lib/cursor-api-analysis-data";
import {
  INTERNAL_ROUTE_DESCRIPTIONS,
  LARGO_TOOL_PROVIDERS,
  ROUTE_PROVIDER_CHAIN,
} from "@/lib/cursor-api-analysis-meta";

type ExternalRow = { readonly path: string; readonly files: readonly string[] };

function EndpointTable({
  rows,
  baseUrl,
  showFiles = true,
}: {
  rows: readonly ExternalRow[];
  baseUrl?: string;
  showFiles?: boolean;
}) {
  return (
    <div className="docs-rest-table-wrap">
      <table className="docs-table docs-rest-table">
        <thead>
          <tr>
            <th>Path</th>
            {showFiles && <th>Source files</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <td>
                <code className="docs-rest-path">
                  {baseUrl}
                  {row.path}
                </code>
              </td>
              {showFiles && (
                <td className="docs-rest-usecases">
                  {row.files.map((f) => (
                    <code key={f} className="docs-file-ref">
                      {f}
                    </code>
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PROVIDER_BASE: Record<string, string> = {
  polygon: "https://api.massive.com",
  unusual_whales: "https://api.unusualwhales.com",
  finnhub: "https://finnhub.io",
  anthropic: "https://api.anthropic.com",
  engine: process.env.NEXT_PUBLIC_API_BASE ?? "(NEXT_PUBLIC_API_BASE)",
  web_search: "",
};

export default function CursorApiAnalysisPage() {
  const { summary, internalRoutes, external, clientCalls, largoTools, generatedAt } =
    CURSOR_API_ANALYSIS;
  const [providerFilter, setProviderFilter] = useState<string>("all");

  const generated = useMemo(
    () => new Date(generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET",
    [generatedAt]
  );

  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">Blackout · Engineering reference</p>
        <h1 className="docs-title">API Usage Analysis</h1>
        <p className="docs-lead">
          Full codebase scan of every internal Next.js route, external provider call, client consumer,
          and Largo tool backing. Generated {generated}. Re-run:{" "}
          <code>node scripts/analyze-api-usage.mjs</code>
        </p>
        <div className="docs-header-links">
          <Link href="/docs/polygon" className="docs-back-link">
            Polygon docs →
          </Link>
          <Link href="/docs/unusual-whales" className="docs-back-link">
            UW docs →
          </Link>
          <Link href="/docs/cursor-api-analysis/live-probe" className="docs-back-link">
            Live probe →
          </Link>
        </div>
      </header>

      <section className="docs-section">
        <h2>Summary</h2>
        <div className="docs-analysis-grid">
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.internalRoutes}</span>
            <span className="docs-analysis-label">Internal routes</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.polygonEndpoints}</span>
            <span className="docs-analysis-label">Polygon paths</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.uwEndpoints}</span>
            <span className="docs-analysis-label">UW paths</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.finnhubEndpoints}</span>
            <span className="docs-analysis-label">Finnhub paths</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.largoTools}</span>
            <span className="docs-analysis-label">Largo tools</span>
          </div>
          <div className="docs-analysis-stat">
            <span className="docs-analysis-num">{summary.clientCalls}</span>
            <span className="docs-analysis-label">Client API calls</span>
          </div>
        </div>
      </section>

      <section className="docs-section">
        <h2>Architecture</h2>
        <pre className="docs-code docs-mermaid">{`Browser (React)
    │
    ├─ /api/market/*  ──► Polygon / UW / Finnhub / Postgres / Claude
    ├─ /api/engine/*  ──► Blackout Engine (optional overlay)
    ├─ /api/admin/*   ──► Telemetry + Postgres
    ├─ /api/cron/*    ──► Scheduled jobs (CRON_SECRET)
    └─ /api/webhook/* ──► Whop membership

Provider policy: Polygon first (unlimited) · UW for flow exclusives`}</pre>
      </section>

      <section className="docs-section" id="internal-routes">
        <h2>Internal BlackOut API routes ({summary.internalRoutes})</h2>
        <div className="docs-rest-table-wrap">
          <table className="docs-table docs-rest-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Description</th>
                <th>Upstream providers</th>
                <th>Route file</th>
              </tr>
            </thead>
            <tbody>
              {internalRoutes.map((route) => (
                <tr key={`${route.method}-${route.path}`}>
                  <td>
                    <span className="docs-rest-method">{route.method}</span>
                  </td>
                  <td>
                    <code>{route.path}</code>
                  </td>
                  <td>{INTERNAL_ROUTE_DESCRIPTIONS[route.path] ?? "—"}</td>
                  <td className="docs-rest-usecases">{ROUTE_PROVIDER_CHAIN[route.path] ?? "—"}</td>
                  <td>
                    <code className="docs-file-ref">{route.file}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="docs-section" id="client-calls">
        <h2>Client consumers ({summary.clientCalls})</h2>
        <p>UI components calling internal routes via <code>src/lib/api.ts</code> or direct fetch.</p>
        <div className="docs-rest-table-wrap">
          <table className="docs-table docs-rest-table">
            <thead>
              <tr>
                <th>Internal path</th>
                <th>Consumer files</th>
              </tr>
            </thead>
            <tbody>
              {clientCalls.map((row) => (
                <tr key={row.path}>
                  <td>
                    <code>{row.path}</code>
                  </td>
                  <td>
                    {row.files.map((f) => (
                      <code key={f} className="docs-file-ref">
                        {f}
                      </code>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="docs-section" id="external">
        <h2>External provider endpoints</h2>
        <div className="docs-provider-tabs">
          {(["all", "polygon", "unusual_whales", "finnhub", "anthropic", "engine", "web_search"] as const).map(
            (p) => (
              <button
                key={p}
                type="button"
                className={providerFilter === p ? "docs-provider-tab-active" : "docs-provider-tab"}
                onClick={() => setProviderFilter(p)}
              >
                {p === "all" ? "All" : p.replace("_", " ")}
              </button>
            )
          )}
        </div>
        {(providerFilter === "all" || providerFilter === "polygon") && (
          <>
            <h3 className="docs-subheading">Polygon / Massive ({external.polygon.length})</h3>
            <EndpointTable rows={external.polygon} baseUrl={PROVIDER_BASE.polygon} />
          </>
        )}
        {(providerFilter === "all" || providerFilter === "unusual_whales") && (
          <>
            <h3 className="docs-subheading">Unusual Whales ({external.unusual_whales.length})</h3>
            <EndpointTable rows={external.unusual_whales} baseUrl={PROVIDER_BASE.unusual_whales} />
          </>
        )}
        {(providerFilter === "all" || providerFilter === "finnhub") && (
          <>
            <h3 className="docs-subheading">Finnhub ({external.finnhub.length})</h3>
            <EndpointTable rows={external.finnhub} baseUrl={PROVIDER_BASE.finnhub} />
          </>
        )}
        {(providerFilter === "all" || providerFilter === "anthropic") && (
          <>
            <h3 className="docs-subheading">Anthropic ({external.anthropic.length})</h3>
            <EndpointTable rows={external.anthropic} baseUrl={PROVIDER_BASE.anthropic} />
          </>
        )}
        {(providerFilter === "all" || providerFilter === "engine") && (
          <>
            <h3 className="docs-subheading">Blackout Engine ({external.engine.length})</h3>
            <EndpointTable rows={external.engine} baseUrl={PROVIDER_BASE.engine} />
          </>
        )}
        {(providerFilter === "all" || providerFilter === "web_search") && (
          <>
            <h3 className="docs-subheading">Web search ({external.web_search.length})</h3>
            <EndpointTable rows={external.web_search} showFiles />
          </>
        )}
      </section>

      <section className="docs-section" id="largo-tools">
        <h2>Largo AI tools ({summary.largoTools})</h2>
        <p>
          Tools invoked by <code>POST /api/market/largo/query</code> via Anthropic tool loop in{" "}
          <code>src/lib/largo/run-tool.ts</code>.
        </p>
        <div className="docs-rest-table-wrap">
          <table className="docs-table docs-rest-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Primary data source</th>
              </tr>
            </thead>
            <tbody>
              {largoTools.map((tool) => (
                <tr key={tool}>
                  <td>
                    <code>{tool}</code>
                  </td>
                  <td>{LARGO_TOOL_PROVIDERS[tool] ?? "Mixed / internal"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="docs-section">
        <h2>Other integrations</h2>
        <table className="docs-table">
          <tbody>
            <tr>
              <th>Whop SDK</th>
              <td>
                <code>members.list</code>, <code>memberships.list</code> —{" "}
                <code>src/lib/whop.ts</code>, <code>src/lib/membership.ts</code>
              </td>
            </tr>
            <tr>
              <th>Discord webhook</th>
              <td>
                <code>POST DISCORD_FLOW_WEBHOOK_URL</code> — flow-ingest notifications
              </td>
            </tr>
            <tr>
              <th>Postgres</th>
              <td>
                Flow cache, SPX outcomes, Largo sessions, Night Hawk editions —{" "}
                <code>src/lib/db.ts</code>
              </td>
            </tr>
            <tr>
              <th>Clerk</th>
              <td>Auth middleware — all premium routes</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="docs-section">
        <h2>Regenerate this report</h2>
        <pre className="docs-code">{`# Scan src/ for routes + provider calls (excludes docs reference files)
node scripts/analyze-api-usage.mjs

# Output: src/lib/cursor-api-analysis-data.ts
# View:   /docs/cursor-api-analysis`}</pre>
      </section>
    </main>
  );
}
