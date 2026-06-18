import Link from "next/link";
import { MASSIVE_DOCS_BASE, MASSIVE_WS_OPTIONS } from "@/lib/polygon-docs-nav";

export const revalidate = 0;

/** Example OCC options ticker for subscribe examples. */
const EXAMPLE_CONTRACT = "O:SPXW250616C05850000";

type FeedRow = {
  name: string;
  channel: string;
  path: string;
  description: string;
  useCases: string;
  plan: "included" | "addon" | "business";
  planNote: string;
  docUrl: string;
  subscribeNote?: string;
};

const FEEDS: FeedRow[] = [
  {
    name: "Aggregates (Per Minute)",
    channel: "AM",
    path: "/options/AM",
    description:
      "Minute-by-minute OHLC and volume for a specified options contract. Updated continuously in ET. Bars only emit when qualifying trades occur in that minute.",
    useCases: "Real-time monitoring, dynamic charting, intraday strategy development, automated trading.",
    plan: "included",
    planNote: "Options Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/options/aggregates-per-minute`,
  },
  {
    name: "Aggregates (Per Second)",
    channel: "A",
    path: "/options/A",
    description:
      "Second-by-second OHLC and volume for a specified options contract. Same bar construction rules as minute aggregates — qualifying trades only.",
    useCases: "Real-time monitoring, dynamic charting, intraday strategy development, automated trading.",
    plan: "included",
    planNote: "Options Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/options/aggregates-per-second`,
  },
  {
    name: "Trades",
    channel: "T",
    path: "/options/T",
    description:
      "Tick-level trade data for option contracts: price, size, exchange, conditions, timestamps as they occur.",
    useCases: "Live monitoring, algorithmic trading, market analysis, data visualization.",
    plan: "included",
    planNote: "Options Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/options/trades`,
  },
  {
    name: "Quotes",
    channel: "Q",
    path: "/options/Q",
    description:
      "Best bid/ask, sizes, and metadata as they update. Due to high bandwidth and message rates, subscriptions are capped at 1,000 option contracts per connection.",
    useCases: "Live monitoring, market analysis, trading decision support, dynamic interface updates.",
    plan: "included",
    planNote: "Options Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/options/quotes`,
    subscribeNote: "Max 1,000 contracts per WebSocket connection",
  },
  {
    name: "Fair Market Value",
    channel: "FMV",
    path: "/business/options/FMV",
    description:
      "Algorithmically derived real-time FMV estimate per options contract. Business plan exclusive on Massive.",
    useCases: "Pricing strategies, algorithmic modeling, risk assessment, investor decision-making.",
    plan: "business",
    planNote: "Not included — Business plan only",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/options/fair-market-value`,
  },
];

function planBadge(plan: FeedRow["plan"]) {
  if (plan === "included") return <span className="docs-badge docs-badge-ok">Your plan</span>;
  if (plan === "addon") return <span className="docs-badge docs-badge-warn">Add-on</span>;
  return <span className="docs-badge docs-badge-muted">Business</span>;
}

export default function PolygonWebSocketOptionsPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">WebSocket · Options</p>
        <h1 className="docs-title">Options WebSocket Feeds</h1>
        <p className="docs-lead">
          Real-time streaming U.S. options market data — trades, quotes, aggregate bars (per-minute and
          per-second), and optional FMV for Business subscribers. Push-based delivery for live monitoring,
          algos, and dynamic charting without repeated REST polling.
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon docs index
        </Link>
        <a
          href={`${MASSIVE_DOCS_BASE}/websocket/options/overview`}
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
                <code>{MASSIVE_WS_OPTIONS}</code>
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
                <code>{`{"action":"subscribe","params":"T.${EXAMPLE_CONTRACT},Q.${EXAMPLE_CONTRACT}"`}</code>
              </td>
            </tr>
            <tr>
              <th>Contract format</th>
              <td>
                OCC symbol with <code>O:</code> prefix — e.g. <code>{EXAMPLE_CONTRACT}</code>
              </td>
            </tr>
            <tr>
              <th>Quote limit</th>
              <td>
                Max <strong>1,000</strong> option contracts per connection on the <code>Q</code> feed
              </td>
            </tr>
          </tbody>
        </table>
        <pre className="docs-code">{`// Example flow (Massive options WebSocket)
wss://${MASSIVE_WS_OPTIONS.replace("wss://", "")}

→ {"action":"auth","params":"<API_KEY>"}
→ {"action":"subscribe","params":"AM.${EXAMPLE_CONTRACT},T.${EXAMPLE_CONTRACT}"}

// Event types (ev field): AM | A | T | Q | FMV`}</pre>
      </section>

      <section className="docs-section">
        <h2>Available feeds</h2>
        {FEEDS.map((feed) => (
          <div key={feed.channel} className="docs-feed-card">
            <div className="docs-feed-card-head">
              <h3 className="docs-subheading">{feed.name}</h3>
              {planBadge(feed.plan)}
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
                      {feed.channel}.{EXAMPLE_CONTRACT}
                    </code>
                  </td>
                </tr>
                {feed.subscribeNote && (
                  <tr>
                    <th>Limit</th>
                    <td>{feed.subscribeNote}</td>
                  </tr>
                )}
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
        <h2>Market hours &amp; timezone</h2>
        <p>
          U.S. options activity is concentrated in the standard equity regular session —{" "}
          <strong>Monday through Friday, 9:30 AM – 4:00 PM Eastern Time (ET)</strong>. Limited trading may occur
          outside these hours, but most volume sits in the regular window.
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
            <strong>Co-located with OPRA</strong> — Options Price Reporting Authority consolidation, low latency
            under peak throughput
          </li>
          <li>
            <strong>All U.S. options exchanges</strong> report trades and quotes to OPRA → single authoritative
            NBBO + full trade tape
          </li>
          <li>
            Massive connects directly to OPRA and pushes updates over your subscribed WebSocket channels
          </li>
        </ul>
        <p className="docs-note">
          BlackOut uses REST for options chains, GEX, and max pain today. WebSocket options feeds are documented
          here for future 0DTE pulse, live contract quotes on Night Hawk plays, and sub-second SPX 0DTE monitoring.
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
                <code>T.O:SPXW*</code>
              </td>
              <td>Live 0DTE trade tape on SPX desk (complement UW flow alerts)</td>
            </tr>
            <tr>
              <td>
                <code>Q.O:SPXW*</code>
              </td>
              <td>Real-time bid/ask on playbook strikes (≤1,000 contracts per connection)</td>
            </tr>
            <tr>
              <td>
                <code>AM.O:SPXW*</code> / <code>A.O:SPXW*</code>
              </td>
              <td>Intraday options bar chart on play detail modal</td>
            </tr>
            <tr>
              <td>
                <code>FMV.*</code>
              </td>
              <td>Fair-value vs mid for premium validation (Business plan)</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
