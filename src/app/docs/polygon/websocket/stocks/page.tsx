import Link from "next/link";
import { MASSIVE_DOCS_BASE, MASSIVE_WS_STOCKS } from "@/lib/polygon-docs-nav";

export const revalidate = 0;

type FeedRow = {
  name: string;
  channel: string;
  path: string;
  description: string;
  useCases: string;
  plan: "included" | "addon" | "business";
  planNote: string;
  docUrl: string;
};

const FEEDS: FeedRow[] = [
  {
    name: "Aggregates (Per Minute)",
    channel: "AM",
    path: "/stocks/AM",
    description:
      "Minute-by-minute OHLC and volume. Updated continuously in ET — pre-market, regular, and after-hours. Bars only emit when qualifying trades occur in that minute.",
    useCases: "Real-time monitoring, live charting, intraday strategies, automated trading.",
    plan: "included",
    planNote: "Stocks Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/stocks/aggregates-per-minute`,
  },
  {
    name: "Aggregates (Per Second)",
    channel: "A",
    path: "/stocks/A",
    description:
      "Second-by-second OHLC and volume. Same session coverage as minute aggregates — built only from qualifying trades per second.",
    useCases: "Real-time monitoring, dynamic charting, intraday strategy, automated trading.",
    plan: "included",
    planNote: "Stocks Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/stocks/aggregates-per-second`,
  },
  {
    name: "Trades",
    channel: "T",
    path: "/stocks/T",
    description:
      "Tick-level trade data: price, size, exchange, conditions, timestamps as they occur.",
    useCases: "Live monitoring, algorithmic trading, market analysis, data visualization.",
    plan: "included",
    planNote: "Stocks Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/stocks/trades`,
  },
  {
    name: "Quotes",
    channel: "Q",
    path: "/stocks/Q",
    description:
      "NBBO quote stream — best bid/ask, sizes, and metadata as they update.",
    useCases: "Live monitoring, market analysis, trading decision support, dynamic UI updates.",
    plan: "included",
    planNote: "Stocks Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/stocks/quotes`,
  },
  {
    name: "Limit Up — Limit Down (LULD)",
    channel: "LULD",
    path: "/stocks/LULD",
    description:
      "Real-time LULD events across NYSE, Nasdaq, Cboe BZX, NYSE Arca, NYSE American. Signals price-band breaches, pauses, halts, resumptions. Halt/resumption messages (indicators 17 & 18) NASDAQ-listed only.",
    useCases: "Volatility monitoring, risk management, compliance, strategy adjustments.",
    plan: "included",
    planNote: "Stocks Advanced — your plan",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/stocks/limit-up-limit-down`,
  },
  {
    name: "Net Order Imbalance (NOI)",
    channel: "NOI",
    path: "/stocks/NOI",
    description:
      "NYSE-listed NOI events — buy/sell imbalance ahead of scheduled auctions (open/close) and intraday halt mini-auctions. Includes indicative clearing price, paired quantity, imbalance size.",
    useCases: "Auction price discovery, execution timing, liquidity monitoring, short-term signals.",
    plan: "addon",
    planNote: "Not included — Imbalances Expansion add-on ($49/mo individual)",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/stocks/imbalances`,
  },
  {
    name: "Fair Market Value",
    channel: "FMV",
    path: "/business/stocks/FMV",
    description:
      "Algorithmically derived real-time FMV estimate per ticker. Business plan exclusive on Massive.",
    useCases: "Pricing strategies, algorithmic modeling, risk assessment, investor decision-making.",
    plan: "business",
    planNote: "Not included — Business plan only",
    docUrl: `${MASSIVE_DOCS_BASE}/websocket/stocks/fair-market-value`,
  },
];

function planBadge(plan: FeedRow["plan"]) {
  if (plan === "included") return <span className="docs-badge docs-badge-ok">Your plan</span>;
  if (plan === "addon") return <span className="docs-badge docs-badge-warn">Add-on</span>;
  return <span className="docs-badge docs-badge-muted">Business</span>;
}

export default function PolygonWebSocketStocksPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">WebSocket · Stocks</p>
        <h1 className="docs-title">Stocks WebSocket Feeds</h1>
        <p className="docs-lead">
          Real-time streaming U.S. equity data via WebSocket — trades, quotes, aggregates, LULD, and optional
          imbalance/FMV feeds. Push-based delivery with minimal latency for dashboards, algos, and live desk
          surfaces.
        </p>
        <Link href="/docs/polygon" className="docs-back-link">
          ← Polygon docs index
        </Link>
        <a
          href={`${MASSIVE_DOCS_BASE}/websocket/stocks/overview`}
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
                <code>{MASSIVE_WS_STOCKS}</code>
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
                <code>{'{"action":"subscribe","params":"AM.NVDA,T.NVDA,Q.NVDA"}'}</code>
              </td>
            </tr>
            <tr>
              <th>Wildcards</th>
              <td>
                <code>AM.*</code> all tickers · comma-separated list for multiple symbols
              </td>
            </tr>
          </tbody>
        </table>
        <pre className="docs-code">{`// Example flow (Massive stocks WebSocket)
wss://${MASSIVE_WS_STOCKS.replace("wss://", "")}

→ {"action":"auth","params":"<API_KEY>"}
→ {"action":"subscribe","params":"AM.SPY,AM.NVDA,T.SPY,Q.SPY"}

// Event types (ev field): AM | A | T | Q | LULD | NOI | FMV`}</pre>
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
                      {feed.channel}.SYMBOL
                    </code>{" "}
                    e.g. <code>{feed.channel}.NVDA</code>
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
        <h2>Market hours &amp; timezone</h2>
        <p>All stock WebSocket data follows U.S. equity sessions in <strong>Eastern Time (ET)</strong>:</p>
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
          Streams stay active outside regular hours; update frequency depends on market activity and feed type.
          Timestamps are <strong>Unix (UTC)</strong> — convert to ET when aligning with session boundaries or
          chart axes.
        </p>
      </section>

      <section className="docs-section">
        <h2>Infrastructure &amp; data flow</h2>
        <ul className="docs-list">
          <li>
            <strong>Co-located servers</strong> with exchanges and SIPs — low latency, stable delivery under load
          </li>
          <li>
            <strong>Same sources as REST</strong> — direct exchange feeds + SIP-consolidated tape
          </li>
          <li>
            Events publish from exchanges/SIPs → Massive infra → your subscribed WebSocket clients
          </li>
        </ul>
        <p className="docs-note">
          BlackOut today uses REST polling for desk lanes (SPX pulse 1s, flow 2s, full desk 10s). WebSocket feeds
          are documented here for future real-time surfaces (flow tape SSE fan-out, live charts, sub-second pulse).
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
                <code>AM.I:SPX</code> / <code>AM.SPY</code>
              </td>
              <td>Sub-second SPX desk pulse (replace 1s REST poll)</td>
            </tr>
            <tr>
              <td>
                <code>T.*</code> + <code>Q.*</code>
              </td>
              <td>Live ticker tape, Largo live quote without REST round-trip</td>
            </tr>
            <tr>
              <td>
                <code>LULD.*</code>
              </td>
              <td>Halt/volatility alerts on Flow Feed or SPX panel</td>
            </tr>
            <tr>
              <td>
                <code>NOI.*</code>
              </td>
              <td>Opening/closing auction imbalance context (requires add-on)</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
