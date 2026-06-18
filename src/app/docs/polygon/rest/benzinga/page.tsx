import Link from "next/link";
import {
  BENZINGA_NEWS_PATH,
  BENZINGA_QUERY_PARAMS,
  BENZINGA_RESPONSE_FIELDS,
} from "@/lib/polygon-docs-benzinga-rest";
import { MASSIVE_DOCS_BASE, MASSIVE_REST_BASE } from "@/lib/polygon-docs-nav";

export const revalidate = 0;

export default function PolygonRestBenzingaPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">REST API · Partners · Benzinga</p>
        <h1 className="docs-title">Real-time Benzinga News</h1>
        <p className="docs-lead">
          Structured, timestamped news from Benzinga — headlines, full-text, tickers, categories, teasers, and
          images. Filter by ticker and time for alerting, risk analysis, and sentiment-driven strategies. Some
          headline-only articles ship faster for time-sensitive market news.
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon docs index
        </Link>
        <a
          href={`${MASSIVE_DOCS_BASE}/rest/partners/benzinga/news`}
          target="_blank"
          rel="noopener noreferrer"
          className="docs-download-link"
        >
          Official Massive doc ↗
        </a>
      </header>

      <section className="docs-section">
        <div className="docs-feed-card-head">
          <h2 className="docs-subheading">Endpoint</h2>
          <span className="docs-badge docs-badge-ok">Your plan</span>
        </div>
        <table className="docs-table docs-table-compact">
          <tbody>
            <tr>
              <th>Method</th>
              <td>
                <span className="docs-rest-method">GET</span>
              </td>
            </tr>
            <tr>
              <th>Path</th>
              <td>
                <code>
                  {MASSIVE_REST_BASE}
                  {BENZINGA_NEWS_PATH}
                </code>
              </td>
            </tr>
            <tr>
              <th>Plan</th>
              <td>Benzinga News — $99/mo (your plan)</td>
            </tr>
            <tr>
              <th>Recency</th>
              <td>Real-time</td>
            </tr>
            <tr>
              <th>History</th>
              <td>All history — records back to December 5, 2001</td>
            </tr>
          </tbody>
        </table>
        <p className="docs-note">
          <strong>Use cases:</strong> Market news feeds, alerting systems, portfolio monitoring, dashboards.
        </p>
      </section>

      <section className="docs-section">
        <h2>Example request</h2>
        <pre className="docs-code">{`GET ${MASSIVE_REST_BASE}${BENZINGA_NEWS_PATH}
    ?limit=12
    &sort=published.desc
    &tickers.any_of=SPX
    &published.gte=2024-05-28T13:30:00Z
    &apiKey=<POLYGON_API_KEY>

// BlackOut default: limit=12, sort=published.desc
// Optional filters: tickers.any_of, channels.any_of, published.gte`}</pre>
      </section>

      <section className="docs-section">
        <h2>Query parameters</h2>
        <div className="docs-rest-table-wrap">
          <table className="docs-table docs-rest-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Type</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {BENZINGA_QUERY_PARAMS.map((p) => (
                <tr key={p.name}>
                  <td>
                    <code>{p.name}</code>
                  </td>
                  <td>{p.type}</td>
                  <td>{p.default === "—" ? "—" : <code>{p.default}</code>}</td>
                  <td>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="docs-note">
          Most array and timestamp fields support Massive filter modifiers — e.g.{" "}
          <code>published.gte</code>, <code>published.lte</code>, <code>tickers.any_of</code>,{" "}
          <code>channels.any_of</code>.
        </p>
      </section>

      <section className="docs-section">
        <h2>Response attributes</h2>
        <div className="docs-rest-table-wrap">
          <table className="docs-table docs-rest-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {BENZINGA_RESPONSE_FIELDS.map((f) => (
                <tr key={f.name}>
                  <td>
                    <code>{f.name}</code>
                    {f.optional && <span className="docs-badge docs-badge-muted docs-rest-dep">optional</span>}
                  </td>
                  <td>{f.type}</td>
                  <td>{f.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="docs-section">
        <h2>Example response shape</h2>
        <pre className="docs-code">{`{
  "status": "OK",
  "request_id": "...",
  "next_url": "https://api.massive.com/benzinga/v2/news?cursor=...",
  "results": [
    {
      "benzinga_id": 123456,
      "title": "Market headline...",
      "teaser": "Short summary...",
      "body": "Full article text (optional)...",
      "author": "Benzinga Newsdesk",
      "published": "2024-05-28T20:27:41Z",
      "last_updated": "2024-05-28T20:28:00Z",
      "tickers": ["SPY", "AAPL"],
      "channels": ["News", "Price Target"],
      "tags": ["earnings", "analyst"],
      "images": ["https://..."],
      "url": "https://www.benzinga.com/..."
    }
  ]
}`}</pre>
      </section>

      <section className="docs-section">
        <h2>BlackOut usage today</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Surface</th>
              <th>How we call it</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>GET /api/market/news</code>
              </td>
              <td>Desk news rail + ticker — Benzinga first via <code>fetchBenzingaNews()</code></td>
            </tr>
            <tr>
              <td>Night Hawk dossiers</td>
              <td>Catalyst context — Benzinga → Polygon news → Finnhub → UW fallback</td>
            </tr>
            <tr>
              <td>Largo <code>get_desk_news</code></td>
              <td>Same priority stack for agent queries</td>
            </tr>
            <tr>
              <td>SPX desk</td>
              <td>BenzingaNewsRail / BenzingaNewsTicker components poll every 60s</td>
            </tr>
          </tbody>
        </table>
        <p className="docs-note">
          Implementation: <code>src/lib/providers/polygon.ts</code> → <code>fetchBenzingaNews()</code>. Default
          limit 12 (max 50 in code); maps <code>benzinga_id</code>, <code>title</code>, <code>teaser</code>,{" "}
          <code>body</code>, <code>tickers</code>, <code>channels</code>, <code>tags</code>, <code>url</code>.
        </p>
      </section>
    </main>
  );
}
