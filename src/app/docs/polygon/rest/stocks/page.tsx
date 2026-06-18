import Link from "next/link";
import { PolygonRestEndpointTable } from "@/components/docs/PolygonRestEndpointTable";
import { MASSIVE_DOCS_BASE, MASSIVE_REST_BASE } from "@/lib/polygon-docs-nav";
import { STOCKS_REST_SECTIONS, STOCKS_REST_TOC } from "@/lib/polygon-docs-stocks-rest";

export const revalidate = 0;

export default function PolygonRestStocksPage() {
  const endpointCount = STOCKS_REST_SECTIONS.reduce((n, s) => n + s.endpoints.length, 0);

  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">REST API · Stocks</p>
        <h1 className="docs-title">Stocks REST Endpoints</h1>
        <p className="docs-lead">
          Comprehensive U.S. stock market data — real-time prices, historical aggs, snapshots, trades, quotes,
          fundamentals, filings, and news from 19 major exchanges, dark pools, FINRA facilities, and OTC markets.
          All {endpointCount} endpoints below are included on <strong>Stocks Advanced</strong> (your plan).
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon docs index
        </Link>
        <a
          href={`${MASSIVE_DOCS_BASE}/rest/stocks/overview`}
          target="_blank"
          rel="noopener noreferrer"
          className="docs-download-link"
        >
          Official Massive overview ↗
        </a>
      </header>

      <section className="docs-section">
        <h2>Base URL</h2>
        <pre className="docs-code">{`GET ${MASSIVE_REST_BASE}/v2/aggs/ticker/SPY/range/1/minute/2024-01-09/2024-01-09
    ?apiKey=<POLYGON_API_KEY>

// Env: POLYGON_API_KEY or MASSIVE_API_KEY
// Base override: POLYGON_API_BASE (defaults to ${MASSIVE_REST_BASE})`}</pre>
      </section>

      <section className="docs-section">
        <h2>Jump to section</h2>
        <nav className="docs-rest-toc" aria-label="Stocks REST sections">
          {STOCKS_REST_TOC.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="docs-rest-toc-link">
              {item.title}
              <span className="docs-rest-toc-count">{item.count}</span>
            </a>
          ))}
        </nav>
      </section>

      <PolygonRestEndpointTable sections={STOCKS_REST_SECTIONS} />

      <section className="docs-section">
        <h2>Market hours &amp; timezone</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Hours (ET)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pre-market</td>
              <td>4:00 AM – 9:30 AM</td>
            </tr>
            <tr>
              <td>Regular</td>
              <td>9:30 AM – 4:00 PM</td>
            </tr>
            <tr>
              <td>After-hours</td>
              <td>4:00 PM – 8:00 PM</td>
            </tr>
          </tbody>
        </table>
        <p>
          Snapshots clear daily at <strong>3:30 AM EST</strong> and repopulate from ~4:00 AM EST. All timestamps
          are <strong>Unix (UTC)</strong> — convert to ET for session alignment.
        </p>
      </section>

      <section className="docs-section">
        <h2>BlackOut usage today</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>BlackOut surface</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>/v2/snapshot/.../tickers/&#123;ticker&#125;</code>
              </td>
              <td>SPX desk pulse, Largo live quotes, heatmap</td>
            </tr>
            <tr>
              <td>
                <code>/v2/snapshot/.../stocks/&#123;direction&#125;</code>
              </td>
              <td>Heatmap top movers</td>
            </tr>
            <tr>
              <td>
                <code>/v2/aggs/ticker/.../range/...</code>
              </td>
              <td>SPX intraday bars, Night Hawk dossier context</td>
            </tr>
            <tr>
              <td>
                <code>/v2/last/nbbo/&#123;ticker&#125;</code>
              </td>
              <td>Largo quote fallback</td>
            </tr>
            <tr>
              <td>
                <code>/stocks/v1/short-interest</code> · <code>/stocks/v1/short-volume</code>
              </td>
              <td>Night Hawk dossier short data</td>
            </tr>
            <tr>
              <td>
                <code>/v2/reference/news</code>
              </td>
              <td>Desk news (after Benzinga)</td>
            </tr>
            <tr>
              <td>
                <code>/v1/marketstatus/now</code>
              </td>
              <td>Session gates across desk APIs</td>
            </tr>
          </tbody>
        </table>
        <p className="docs-note">
          Probe note: <code>/v1/related-companies/&#123;ticker&#125;</code> and <code>/stocks/vX/float</code> returned
          404 in our live probe — verify path/version before wiring into production.
        </p>
      </section>
    </main>
  );
}
