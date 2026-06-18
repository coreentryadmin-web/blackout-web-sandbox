import Link from "next/link";
import { MASSIVE_DOCS_BASE, MASSIVE_WS_INDICES } from "@/lib/polygon-docs-nav";

export const revalidate = 0;

/** Massive index ticker prefix used in REST and WebSocket subscriptions. */
const EXAMPLE_INDEX = "I:SPX";

type FeedRow = {
  name: string;
  channel: string;
  path: string;
  description: string;
  useCases: string;
  planNote: string;
  docUrl: string;
};

const FEEDS: FeedRow[] = [
  {
    name: "Aggregates (Per Minute)",
    channel: "AM",
    path: "/indices/AM",
    description:
      "Minute-by-minute aggregated OHLC for a specified index. Updated continuously in ET. Unlike stocks or options, bars are derived from index value updates — not individual trades. No bar is emitted if no new index updates occur in that minute.",
    useCases: "Real-time monitoring, dynamic charting, intraday trend analysis, market research.",
    planNote: "Indices Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/indices/aggregates-per-minute`,
  },
  {
    name: "Aggregates (Per Second)",
    channel: "A",
    path: "/indices/A",
    description:
      "Second-by-second aggregated OHLC for a specified index. Same construction as minute aggregates — derived from index values, not trades.",
    useCases: "Real-time monitoring, dynamic charting, intraday trend analysis, market research.",
    planNote: "Indices Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/indices/aggregates-per-second`,
  },
  {
    name: "Value",
    channel: "V",
    path: "/indices/V",
    description:
      "Real-time index value snapshots — current level and timestamp as the index administrator publishes updates. Supports live benchmark monitoring and trend detection.",
    useCases: "Market analysis, trend detection, portfolio benchmarking, trading strategy refinement.",
    planNote: "Indices Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/indices/value`,
  },
];

export default function PolygonWebSocketIndicesPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">WebSocket · Indices</p>
        <h1 className="docs-title">Indices WebSocket Feeds</h1>
        <p className="docs-lead">
          Real-time streaming index values and aggregates — value snapshots plus per-minute and per-second OHLC
          bars. Track market benchmarks, gauge broad sentiment, and power dynamic dashboards without constant REST
          polling.
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon docs index
        </Link>
        <a
          href={`${MASSIVE_DOCS_BASE}/websocket/indices/overview`}
          target="_blank"
          rel="noopener noreferrer"
          className="docs-download-link"
        >
          Official Massive overview ↗
        </a>
      </header>

      <section className="docs-section">
        <h2>Connection</h2>
        <table className="docs-table">
          <tbody>
            <tr>
              <th>WebSocket URL</th>
              <td>
                <code>{MASSIVE_WS_INDICES}</code>
              </td>
            </tr>
            <tr>
              <th>Auth</th>
              <td>
                Send <code>{'{"action":"auth","params":"YOUR_API_KEY"}'}</code> after connect
              </td>
            </tr>
            <tr>
              <th>Subscribe</th>
              <td>
                <code>{`{"action":"subscribe","params":"V.${EXAMPLE_INDEX},AM.${EXAMPLE_INDEX}"`}</code>
              </td>
            </tr>
            <tr>
              <th>Ticker format</th>
              <td>
                Index prefix <code>I:</code> — e.g. <code>{EXAMPLE_INDEX}</code>, <code>I:VIX</code>,{" "}
                <code>I:VIX9D</code>
              </td>
            </tr>
          </tbody>
        </table>
        <pre className="docs-code">{`// Example flow (Massive indices WebSocket)
wss://${MASSIVE_WS_INDICES.replace("wss://", "")}

→ {"action":"auth","params":"<API_KEY>"}
→ {"action":"subscribe","params":"V.I:SPX,V.I:VIX,AM.I:SPX"}

// Event types (ev field): AM | A | V`}</pre>
      </section>

      <section className="docs-section">
        <h2>Available feeds</h2>
        {FEEDS.map((feed) => (
          <div key={feed.channel} className="docs-feed-card">
            <div className="docs-feed-card-head">
              <h3 className="docs-subheading">{feed.name}</h3>
              <span className="docs-badge docs-badge-ok">Your plan</span>
            </div>
            <table className="docs-table docs-table-compact">
              <tbody>
                <tr>
                  <th>Channel</th>
                  <td>
                    <code>{feed.channel}</code>
                  </td>
                </tr>
                <tr>
                  <th>WS path</th>
                  <td>
                    <code>WS {feed.path}</code>
                  </td>
                </tr>
                <tr>
                  <th>Subscribe</th>
                  <td>
                    <code>
                      {feed.channel}.{EXAMPLE_INDEX}
                    </code>
                  </td>
                </tr>
                <tr>
                  <th>Plan</th>
                  <td>{feed.planNote}</td>
                </tr>
                <tr>
                  <th>Official doc</th>
                  <td>
                    <a href={feed.docUrl} target="_blank" rel="noopener noreferrer">
                      {feed.docUrl.replace(MASSIVE_DOCS_BASE, "")} ↗
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
            <p>{feed.description}</p>
            <p className="docs-note">
              <strong>Use cases:</strong> {feed.useCases}
            </p>
          </div>
        ))}
      </section>

      <section className="docs-section">
        <h2>Index vs stock/options aggregates</h2>
        <p>
          Index <code>AM</code> and <code>A</code> bars are built from <strong>index value updates</strong>, not
          from a trade tape. Refresh cadence follows each index administrator&apos;s methodology — some indices
          tick frequently; others update on fixed intervals.
        </p>
      </section>

      <section className="docs-section">
        <h2>Market hours &amp; timezone</h2>
        <p>
          Most indices align with U.S. equity sessions —{" "}
          <strong>Monday through Friday, 9:30 AM – 4:00 PM Eastern Time (ET)</strong>. Some indices may also
          update during pre-market and after-hours depending on underlying methodology and constituents.
        </p>
        <p>
          Timestamps are <strong>Unix (UTC)</strong>. Convert to ET when aligning with session boundaries or
          chart axes.
        </p>
      </section>

      <section className="docs-section">
        <h2>Infrastructure &amp; data flow</h2>
        <ul className="docs-list">
          <li>
            <strong>Index-specific update patterns</strong> — infrastructure handles interval-based refreshes,
            not just tick-by-tick tape
          </li>
          <li>
            <strong>Direct source connections</strong> — values from exchanges and index administrators,
            standardized before streaming
          </li>
          <li>
            New value published → Massive processing → your subscribed WebSocket channels
          </li>
        </ul>
        <p className="docs-note">
          BlackOut uses REST for SPX/VIX pulse and VIX term structure today. Index WebSocket feeds are documented
          here for sub-second desk pulse and live VIX term monitoring without 1s REST polling.
        </p>
      </section>

      <section className="docs-section">
        <h2>BlackOut mapping (future / optional)</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Massive feed</th>
              <th>Potential BlackOut use</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>V.I:SPX</code>
              </td>
              <td>Sub-second SPX desk pulse — replace 1s REST poll on SPX Slayer</td>
            </tr>
            <tr>
              <td>
                <code>V.I:VIX</code> · <code>V.I:VIX9D</code> · <code>V.I:VIX3M</code>
              </td>
              <td>Live VIX term structure for Night Hawk dossier and SPX commentary</td>
            </tr>
            <tr>
              <td>
                <code>AM.I:SPX</code> / <code>A.I:SPX</code>
              </td>
              <td>Intraday SPX bar chart on desk and play detail surfaces</td>
            </tr>
            <tr>
              <td>
                <code>V.I:NDX</code> · <code>V.I:RUT</code>
              </td>
              <td>Cross-index context on heatmap and Largo benchmark queries</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
