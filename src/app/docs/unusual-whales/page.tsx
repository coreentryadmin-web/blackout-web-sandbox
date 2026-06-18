import Link from "next/link";
import {
  UW_BLACKOUT_ENDPOINT_COUNT,
  UW_DOCS_BASE,
  UW_DOCS_URL,
  UW_ENDPOINT_TOTAL,
  UW_OPENAPI_URL,
  UW_REST_TOC,
} from "@/lib/uw-docs-catalog";

export const revalidate = 0;

export default function UnusualWhalesDocsIndexPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">Blackout · Data providers</p>
        <h1 className="docs-title">Unusual Whales API Reference</h1>
        <p className="docs-lead">
          Internal reference for UW Advanced — {UW_ENDPOINT_TOTAL}+ REST endpoints for options flow, dark pool,
          GEX/greeks, market tide, congress, volatility, and more. Use UW for{" "}
          <strong>flow-only exclusives</strong>; prefer Polygon/Massive for chains, indices, and news.
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon / Massive docs
        </Link>
        <a href={UW_DOCS_URL} target="_blank" rel="noopener noreferrer" className="docs-download-link">
          Official UW docs ↗
        </a>
      </header>

      <section className="docs-section">
        <h2>Connection</h2>
        <table className="docs-table">
          <tbody>
            <tr>
              <th>Base URL</th>
              <td>
                <code>{UW_DOCS_BASE}</code>
              </td>
            </tr>
            <tr>
              <th>Auth</th>
              <td>
                <code>Authorization: Bearer &lt;UW_API_KEY&gt;</code>
              </td>
            </tr>
            <tr>
              <th>Env vars</th>
              <td>
                <code>UW_API_KEY</code>, optional <code>UW_API_BASE</code>
              </td>
            </tr>
            <tr>
              <th>Plan</th>
              <td>UW Advanced — $375/mo (live REST + WebSocket)</td>
            </tr>
            <tr>
              <th>Also available</th>
              <td>WebSocket channels, Kafka streaming, MCP server</td>
            </tr>
          </tbody>
        </table>
        <pre className="docs-code">{`curl -X GET "${UW_DOCS_BASE}/api/market/market-tide" \\
  -H "Authorization: Bearer $UW_API_KEY" \\
  -H "Accept: application/json"`}</pre>
      </section>

      <section className="docs-section">
        <h2>Official resources</h2>
        <table className="docs-table">
          <tbody>
            <tr>
              <th>Docs</th>
              <td>
                <a href={UW_DOCS_URL} target="_blank" rel="noopener noreferrer">
                  {UW_DOCS_URL}
                </a>
              </td>
            </tr>
            <tr>
              <th>OpenAPI</th>
              <td>
                <a href={UW_OPENAPI_URL} target="_blank" rel="noopener noreferrer">
                  {UW_OPENAPI_URL}
                </a>
              </td>
            </tr>
            <tr>
              <th>Kafka</th>
              <td>
                <a
                  href="https://unusualwhales.com/public-api/kafka"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  unusualwhales.com/public-api/kafka
                </a>
              </td>
            </tr>
            <tr>
              <th>MCP Server</th>
              <td>
                <a href="https://unusualwhales.com/public-api/mcp" target="_blank" rel="noopener noreferrer">
                  unusualwhales.com/public-api/mcp
                </a>
              </td>
            </tr>
            <tr>
              <th>API usage</th>
              <td>
                <a
                  href="https://unusualwhales.com/information/how-to-check-your-api-usage"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Check quota / usage
                </a>
              </td>
            </tr>
            <tr>
              <th>Support</th>
              <td>
                <a href="mailto:dev@unusualwhales.com">dev@unusualwhales.com</a>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="docs-section">
        <h2>BlackOut provider policy</h2>
        <ul className="docs-list">
          <li>
            <strong>UW-only</strong> — options flow alerts, dark pool, NOPE, market/sector/ETF tide, screeners,
            congress, lit-flow, unusual trades
          </li>
          <li>
            <strong>Polygon first</strong> — GEX/max pain fallback only when Polygon chains unavailable; indices,
            Benzinga news, stock snapshots
          </li>
          <li>
            <strong>{UW_BLACKOUT_ENDPOINT_COUNT} endpoints</strong> wired or referenced in{" "}
            <code>src/lib/providers/unusual-whales.ts</code> and Largo tools
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>Endpoint categories</h2>
        <p>
          Full catalog with paths and operation IDs:{" "}
          <Link href="/docs/unusual-whales/endpoints">All endpoints →</Link>
        </p>
        <div className="docs-rest-toc">
          {UW_REST_TOC.map((item) => (
            <Link
              key={item.id}
              href={`/docs/unusual-whales/endpoints#${item.id}`}
              className="docs-rest-toc-link"
            >
              {item.title}
              <span className="docs-rest-toc-count">{item.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="docs-section">
        <h2>BlackOut surfaces (primary UW calls)</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>BlackOut use</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>/api/option-trades/flow-alerts</code>
              </td>
              <td>Flow Feed ingest, cron, SSE stream</td>
            </tr>
            <tr>
              <td>
                <code>/api/market/market-tide</code>
              </td>
              <td>SPX desk flow lane, health probe</td>
            </tr>
            <tr>
              <td>
                <code>/api/stock/&#123;ticker&#125;/flow-alerts</code>
              </td>
              <td>SPX / ticker flow panel</td>
            </tr>
            <tr>
              <td>
                <code>/api/darkpool/&#123;ticker&#125;</code>
              </td>
              <td>Desk dark pool lane</td>
            </tr>
            <tr>
              <td>
                <code>/api/stock/SPX/spot-exposures/*</code>
              </td>
              <td>GEX fallback when Polygon unavailable</td>
            </tr>
            <tr>
              <td>
                <code>/api/stock/&#123;ticker&#125;/nope</code>
              </td>
              <td>Desk NOPE indicator</td>
            </tr>
            <tr>
              <td>
                <code>/api/volatility/vix-term-structure</code>
              </td>
              <td>Night Hawk VIX term (Polygon preferred when available)</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="docs-section">
        <h2>Historical option trades add-on</h2>
        <p>
          Full-market historical option trades: <strong>$250/mo</strong> (10% discount for 1+ year). Enterprise /
          redistribution: contact{" "}
          <a href="mailto:dev@unusualwhales.com">dev@unusualwhales.com</a>.
        </p>
      </section>
    </main>
  );
}
