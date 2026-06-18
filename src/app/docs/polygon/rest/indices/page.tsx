import Link from "next/link";
import { PolygonRestEndpointTable } from "@/components/docs/PolygonRestEndpointTable";
import { MASSIVE_DOCS_BASE, MASSIVE_REST_BASE } from "@/lib/polygon-docs-nav";
import { INDICES_REST_SECTIONS, INDICES_REST_TOC } from "@/lib/polygon-docs-indices-rest";
import { restEndpointCount } from "@/lib/polygon-docs-rest-types";

export const revalidate = 0;

export default function PolygonRestIndicesPage() {
  const endpointCount = restEndpointCount(INDICES_REST_SECTIONS);

  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">REST API · Indices</p>
        <h1 className="docs-title">Indices REST Endpoints</h1>
        <p className="docs-lead">
          Market data for 10,000+ indices — S&amp;P, Nasdaq, Dow Jones, and more. Real-time values, historical
          aggs, snapshots, and technical indicators. All {endpointCount} endpoints below are included on{" "}
          <strong>Indices Advanced</strong> (your plan).
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon docs index
        </Link>
        <a
          href={`${MASSIVE_DOCS_BASE}/rest/indices/overview`}
          target="_blank"
          rel="noopener noreferrer"
          className="docs-download-link"
        >
          Official Massive overview ↗
        </a>
      </header>

      <section className="docs-section">
        <h2>Base URL</h2>
        <pre className="docs-code">{`GET ${MASSIVE_REST_BASE}/v3/snapshot/indices
    ?ticker.any_of=I:SPX,I:VIX,I:VIX9D,I:VIX3M
    &apiKey=<POLYGON_API_KEY>

GET ${MASSIVE_REST_BASE}/v2/aggs/ticker/I:SPX/range/1/minute/2024-01-09/2024-01-09
    ?apiKey=<POLYGON_API_KEY>

// Index ticker prefix: I:SPX · I:VIX · I:NDX · I:RUT
// Env: POLYGON_API_KEY or MASSIVE_API_KEY`}</pre>
      </section>

      <section className="docs-section">
        <h2>Jump to section</h2>
        <nav className="docs-rest-toc" aria-label="Indices REST sections">
          {INDICES_REST_TOC.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="docs-rest-toc-link">
              {item.title}
              <span className="docs-rest-toc-count">{item.count}</span>
            </a>
          ))}
        </nav>
      </section>

      <PolygonRestEndpointTable sections={INDICES_REST_SECTIONS} />

      <section className="docs-section">
        <h2>Index vs stock/options aggregates</h2>
        <p>
          Index <code>AM</code> and custom aggs are built from <strong>index value updates</strong>, not from a
          trade tape. Refresh cadence follows each index administrator&apos;s methodology.
        </p>
      </section>

      <section className="docs-section">
        <h2>Market hours &amp; timezone</h2>
        <p>
          Most U.S. indices align with equity regular session —{" "}
          <strong>Monday through Friday, 9:30 AM – 4:00 PM Eastern Time (ET)</strong>. Some indices may also
          update during pre-market and after-hours depending on methodology and underlying constituents.
        </p>
        <p>
          Timestamps are <strong>Unix (UTC)</strong> — convert to ET for session alignment.
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
                <code>/v3/snapshot/indices</code>
              </td>
              <td>SPX desk pulse — SPX, VIX, VIX9D, VIX3M live values</td>
            </tr>
            <tr>
              <td>
                <code>/v2/aggs/ticker/I:SPX/range/...</code>
              </td>
              <td>SPX intraday bars, merged desk route, commentary context</td>
            </tr>
            <tr>
              <td>
                <code>/v2/aggs/ticker/I:VIX/prev</code> · <code>I:VIX9D</code> · <code>I:VIX3M</code>
              </td>
              <td>Night Hawk VIX term structure, SPX dossier</td>
            </tr>
            <tr>
              <td>
                <code>/v1/marketstatus/now</code>
              </td>
              <td>Session gates across desk APIs</td>
            </tr>
            <tr>
              <td>
                <code>/v3/reference/tickers</code>
              </td>
              <td>Index ticker discovery for Largo benchmark queries</td>
            </tr>
          </tbody>
        </table>
        <p className="docs-note">
          SPX Slayer pulse polls indices snapshot every 1s during market hours. WebSocket{" "}
          <code>V.I:SPX</code> documented under WebSocket → Indices for future sub-second pulse.
        </p>
      </section>
    </main>
  );
}
