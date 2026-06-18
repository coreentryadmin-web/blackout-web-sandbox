import Link from "next/link";
import {
  MASSIVE_DOCS_BASE,
  MASSIVE_REST_BASE,
  MASSIVE_WS_INDICES,
  MASSIVE_WS_OPTIONS,
  MASSIVE_WS_STOCKS,
} from "@/lib/polygon-docs-nav";

export const revalidate = 0;

export default function PolygonDocsIndexPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">Blackout · Data providers</p>
        <h1 className="docs-title">Polygon / Massive API Reference</h1>
        <p className="docs-lead">
          Internal reference for our four Advanced subscriptions: <strong>Stocks</strong>,{" "}
          <strong>Options</strong>, <strong>Indices</strong>, and <strong>Benzinga</strong>. Polygon.io
          rebranded to Massive.com — existing API keys and <code>api.massive.com</code> REST base continue to
          work. Use Polygon first (unlimited); reserve Unusual Whales for flow-only data.
        </p>
        <Link href="/nighthawk" className="docs-back-link">
          ← Back to Night Hawk
        </Link>
        <Link href="/docs/unusual-whales" className="docs-back-link">
          Unusual Whales API docs →
        </Link>
        <Link href="/docs/cursor-api-analysis" className="docs-back-link">
          API usage analysis →
        </Link>
        <Link href="/docs/api-probe" className="docs-back-link">
          Live probe results →
        </Link>
      </header>

      <section className="docs-section">
        <h2>Connection endpoints</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>URL</th>
              <th>Env var</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>REST</td>
              <td>
                <code>{MASSIVE_REST_BASE}</code>
              </td>
              <td>
                <code>POLYGON_API_KEY</code> or <code>MASSIVE_API_KEY</code>
              </td>
            </tr>
            <tr>
              <td>WebSocket (Stocks)</td>
              <td>
                <code>{MASSIVE_WS_STOCKS}</code>
              </td>
              <td rowSpan={3}>Same API key — auth on connect</td>
            </tr>
            <tr>
              <td>WebSocket (Options)</td>
              <td>
                <code>{MASSIVE_WS_OPTIONS}</code>
              </td>
            </tr>
            <tr>
              <td>WebSocket (Indices)</td>
              <td>
                <code>{MASSIVE_WS_INDICES}</code>
              </td>
            </tr>
            <tr>
              <td>Official docs</td>
              <td colSpan={2}>
                <a href={MASSIVE_DOCS_BASE} target="_blank" rel="noopener noreferrer">
                  {MASSIVE_DOCS_BASE}
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="docs-section">
        <h2>BlackOut provider policy</h2>
        <ul className="docs-list">
          <li>
            <strong>Polygon first</strong> — quotes, aggs, chains, GEX, indices, Benzinga news, short data
          </li>
          <li>
            <strong>UW only</strong> — options flow alerts, dark pool, NOPE, market/sector/ETF tide, screeners,
            congress
          </li>
          <li>
            Live probe script: <code>node scripts/probe-polygon.mjs</code> (reads key from{" "}
            <code>.env.local</code> only)
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>Documentation sections</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Section</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Link href="/docs/polygon/websocket/stocks">WebSocket → Stocks</Link>
              </td>
              <td>Live — AM, A, T, Q, LULD, NOI, FMV</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/polygon/websocket/options">WebSocket → Options</Link>
              </td>
              <td>Live — AM, A, T, Q, FMV</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/polygon/websocket/indices">WebSocket → Indices</Link>
              </td>
              <td>Live — AM, A, V</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/polygon/rest/stocks">REST → Stocks</Link>
              </td>
              <td>Live — 46 endpoints (tickers, aggs, snapshots, filings, news)</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/polygon/rest/options">REST → Options</Link>
              </td>
              <td>Live — 19 endpoints (contracts, chains, greeks, aggs)</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/polygon/rest/indices">REST → Indices</Link>
              </td>
              <td>Live — 13 endpoints (SPX/VIX snapshots, aggs, indicators)</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/polygon/rest/benzinga">REST → Benzinga</Link>
              </td>
              <td>Live — Real-time news (GET /benzinga/v2/news)</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="docs-section">
        <h2>Our plans (BlackOut desk)</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Subscription</th>
              <th>Tier</th>
              <th>Used by</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Stocks Advanced</td>
              <td>$199/mo</td>
              <td>SPX desk pulse, Largo quotes/aggs, heatmap movers</td>
            </tr>
            <tr>
              <td>Options Advanced</td>
              <td>Real-time chains</td>
              <td>GEX, max pain, Night Hawk positioning, SPX 0DTE</td>
            </tr>
            <tr>
              <td>Indices Advanced</td>
              <td>Real-time</td>
              <td>SPX/VIX/VIX9D/VIX3M, VIX term, index aggs</td>
            </tr>
            <tr>
              <td>Benzinga</td>
              <td>News feed</td>
              <td>Desk news, Night Hawk dossiers, Largo catalysts</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
