import Link from "next/link";
import { PolygonRestEndpointTable } from "@/components/docs/PolygonRestEndpointTable";
import { MASSIVE_DOCS_BASE, MASSIVE_REST_BASE } from "@/lib/polygon-docs-nav";
import { OPTIONS_REST_SECTIONS, OPTIONS_REST_TOC } from "@/lib/polygon-docs-options-rest";
import { restEndpointCount } from "@/lib/polygon-docs-rest-types";

export const revalidate = 0;

const EXAMPLE_CONTRACT = "O:SPXW250616C05850000";

export default function PolygonRestOptionsPage() {
  const endpointCount = restEndpointCount(OPTIONS_REST_SECTIONS);

  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">REST API · Options</p>
        <h1 className="docs-title">Options REST Endpoints</h1>
        <p className="docs-lead">
          Comprehensive U.S. options market data — real-time prices, historical aggs, chain snapshots, trades, and
          quotes from all 17 U.S. options exchanges via OPRA. All {endpointCount} endpoints below are included on{" "}
          <strong>Options Advanced</strong> (your plan).
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon docs index
        </Link>
        <a
          href={`${MASSIVE_DOCS_BASE}/rest/options/overview`}
          target="_blank"
          rel="noopener noreferrer"
          className="docs-download-link"
        >
          Official Massive overview ↗
        </a>
      </header>

      <section className="docs-section">
        <h2>Base URL</h2>
        <pre className="docs-code">{`GET ${MASSIVE_REST_BASE}/v3/snapshot/options/SPX
    ?apiKey=<POLYGON_API_KEY>

GET ${MASSIVE_REST_BASE}/v3/snapshot/options/SPX/${EXAMPLE_CONTRACT}
    ?apiKey=<POLYGON_API_KEY>

// OCC ticker format: O:SPXW250616C05850000
// Env: POLYGON_API_KEY or MASSIVE_API_KEY`}</pre>
      </section>

      <section className="docs-section">
        <h2>Jump to section</h2>
        <nav className="docs-rest-toc" aria-label="Options REST sections">
          {OPTIONS_REST_TOC.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="docs-rest-toc-link">
              {item.title}
              <span className="docs-rest-toc-count">{item.count}</span>
            </a>
          ))}
        </nav>
      </section>

      <PolygonRestEndpointTable sections={OPTIONS_REST_SECTIONS} />

      <section className="docs-section">
        <h2>Market hours &amp; timezone</h2>
        <p>
          U.S. options activity is concentrated in the regular equity session —{" "}
          <strong>Monday through Friday, 9:30 AM – 4:00 PM Eastern Time (ET)</strong>. Limited trading may occur
          outside these hours on some venues.
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
                <code>/v3/snapshot/options/&#123;underlying&#125;</code>
              </td>
              <td>GEX, max pain, Night Hawk positioning, SPX 0DTE chain</td>
            </tr>
            <tr>
              <td>
                <code>/v3/reference/options/contracts</code>
              </td>
              <td>Contract discovery, OI-by-expiry, chain filtering</td>
            </tr>
            <tr>
              <td>
                <code>/v3/snapshot/options/SPX/&#123;contract&#125;</code>
              </td>
              <td>Playbook strike greeks, premium validation on Night Hawk plays</td>
            </tr>
            <tr>
              <td>
                <code>/v2/aggs/ticker/&#123;optionsTicker&#125;/range/...</code>
              </td>
              <td>Intraday options bar history on play detail surfaces</td>
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
          Options flow alerts remain <strong>UW-only</strong>. Polygon covers chains, greeks, OI, IV, and
          snapshots — not unusual-whales-style flow tape. Probe note:{" "}
          <code>/v3/trades/&#123;optionsTicker&#125;</code> and{" "}
          <code>/v3/quotes/&#123;optionsTicker&#125;</code> returned 404 in our live probe — verify path before
          production use.
        </p>
      </section>
    </main>
  );
}
