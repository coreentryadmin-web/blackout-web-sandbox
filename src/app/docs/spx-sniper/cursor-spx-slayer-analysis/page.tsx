import Link from "next/link";
import { requireAdmin } from "@/lib/admin-access";
import { Nav } from "@/components/Nav";

export const revalidate = 0;

export default async function CursorSpxSlayerAnalysisPage() {
  await requireAdmin();

  return (
    <div className="docs-page">
      <Nav />
      <main className="docs-page-main">
        <header className="docs-header">
          <p className="docs-kicker">Blackout · SPX Slayer · Engineering</p>
          <h1 className="docs-title">Cursor SPX Slayer — Full System Analysis</h1>
          <p className="docs-lead">
            End-to-end audit of blackout-web: architecture, data planes, client/server flows, state ownership,
            WebSockets, caching, multi-instance risks, recent fixes, and prioritized roadmap. Generated{" "}
            <strong>2026-06-18</strong>.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
            <Link href="/docs/spx-sniper" className="docs-back-link">
              ← Play Engine Playbook
            </Link>
            <Link href="/docs/system-analysis" className="docs-back-link">
              System Analysis →
            </Link>
            <Link href="/dashboard" className="docs-back-link">
              Live desk →
            </Link>
          </div>
        </header>

        <section className="docs-section">
          <h2>1. What this system is</h2>
          <p>
            <strong>blackout-web</strong> is a Next.js 14 app — the live trading intelligence platform for Blackout
            Trading. SPX Slayer on <code>/dashboard</code> is the core product; other surfaces share the same data
            providers and Postgres state.
          </p>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Route</th>
                <th>Core job</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>SPX Slayer</strong>
                </td>
                <td>
                  <code>/dashboard</code>
                </td>
                <td>Real-time 0DTE SPX desk + play engine + lotto</td>
              </tr>
              <tr>
                <td>HELIX</td>
                <td>
                  <code>/flows</code>
                </td>
                <td>Market-wide unusual options flow</td>
              </tr>
              <tr>
                <td>Heatmap</td>
                <td>
                  <code>/heatmap</code>
                </td>
                <td>Sector thermal + movers</td>
              </tr>
              <tr>
                <td>Largo</td>
                <td>
                  <code>/terminal</code>
                </td>
                <td>Claude agent with 75 market tools</td>
              </tr>
              <tr>
                <td>Night Hawk</td>
                <td>
                  <code>/nighthawk</code>
                </td>
                <td>Evening edition research digest</td>
              </tr>
              <tr>
                <td>Admin</td>
                <td>
                  <code>/admin</code>
                </td>
                <td>SPX engine telemetry + API Command Center</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            <strong>External stack:</strong> Polygon/Massive (primary), Unusual Whales (flow/GEX), Finnhub
            (macro/fundamentals), Anthropic (LLM), Postgres (state), Redis (optional cross-instance cache), Clerk
            (auth), Whop (billing sync).
          </p>
        </section>

        <section className="docs-section">
          <h2>2. System topology</h2>
          <pre className="docs-diagram">{`USERS (/dashboard)
    │
    ├─ useMergedDesk ── REST pulse 1s / flow 2s / desk 10s
    ├─ useSpxPlay ───── REST /spx/play 3s
    └─ useLiveSpxTape ─ flow seed 2s + SSE /flows/stream

NEXT.JS API
    ├─ /spx/pulse (1s cache) ──► buildSpxDeskPulse()
    ├─ /spx/flow  (2s cache) ──► buildSpxDeskFlow()
    ├─ /spx/desk  (10s cache) ─► buildSpxDesk()
    ├─ /spx/play  (premium) ───► loadMergedSpxDesk() → spx-play-engine
    ├─ /flows/stream (SSE) ────► flow-events pub/sub
    └─ /pulse/stream (SSE) ────► indexStore 250ms [no client consumer]

BUILDERS (spx-desk.ts)
    ├─ Polygon REST + UW REST
    ├─ polygon-socket (indexStore)
    └─ uw-socket (tide, dark pool, flow alerts)

STATEFUL ENGINES
    ├─ spx-signals (pure scoring)
    ├─ spx-play-engine (FSM → spx_open_play)
    ├─ spx-lotto-engine (parallel FSM → platform_meta)
    └─ flow-ingest (REST → Postgres + SSE)

PERSISTENCE
    ├─ Postgres (required in prod for play/lotto)
    └─ Redis optional (desk sticky lanes)`}</pre>
        </section>

        <section className="docs-section">
          <h2>3. SPX Slayer data pipeline</h2>
          <p>
            The dashboard does <strong>not</strong> call one monolithic endpoint. It runs three parallel REST lanes
            merged on the client via <code>useMergedDesk</code> → <code>mergeDeskLayers</code> in{" "}
            <code>spx-desk-merge.ts</code>.
          </p>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Lane</th>
                <th>Client poll</th>
                <th>Server cache</th>
                <th>Builder</th>
                <th>Carries</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Pulse</strong>
                </td>
                <td>1s</td>
                <td>1s</td>
                <td>
                  <code>buildSpxDeskPulse()</code>
                </td>
                <td>Price, VIX, VWAP, session stats, regime, market status</td>
              </tr>
              <tr>
                <td>
                  <strong>Flow</strong>
                </td>
                <td>2s</td>
                <td>2s</td>
                <td>
                  <code>buildSpxDeskFlow()</code>
                </td>
                <td>GEX walls, dark pool, unified tape, 0DTE flow prem</td>
              </tr>
              <tr>
                <td>
                  <strong>Full desk</strong>
                </td>
                <td>10s</td>
                <td>10s</td>
                <td>
                  <code>buildSpxDesk()</code>
                </td>
                <td>EMAs, breadth, news, gamma, full merge</td>
              </tr>
            </tbody>
          </table>
          <p>
            <strong>Client persistence:</strong> <code>sessionStorage</code> key <code>spx-merged-desk</code> (12h
            TTL). <strong>Play engine path:</strong> <code>loadMergedSpxDesk()</code> runs the same three builders
            server-side with <code>staleWhileRevalidate: false</code>.
          </p>

          <h3 className="docs-subheading">Panel → data dependencies</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Panel</th>
                <th>Component</th>
                <th>Data source</th>
                <th>Effective refresh</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Header</td>
                <td>
                  <code>SpxSniperHeader</code>
                </td>
                <td>Pulse + desk merge</td>
                <td>Price ~1s; structure ~5–10s</td>
              </tr>
              <tr>
                <td>Intel strip</td>
                <td>
                  <code>SpxIntelStrip</code>
                </td>
                <td>Pulse <code>leader_stocks</code>
                </td>
                <td>~1s during session</td>
              </tr>
              <tr>
                <td>Dark pool</td>
                <td>
                  <code>SpxDarkPoolCard</code>
                </td>
                <td>Flow <code>dark_pool</code>
                </td>
                <td>~2s REST; WS if <code>off_lit_trades</code> up</td>
              </tr>
              <tr>
                <td>GEX ladder</td>
                <td>
                  <code>SpxGexLadder</code>
                </td>
                <td>Flow <code>gex_walls</code>, gamma</td>
                <td>~2s (+ 15s Polygon GEX cache)</td>
              </tr>
              <tr>
                <td>Live tape</td>
                <td>
                  <code>SpxUnifiedTape</code>
                </td>
                <td>Flow seed + SSE</td>
                <td>2s seed; instant on SSE push</td>
              </tr>
              <tr>
                <td>Trade alerts</td>
                <td>
                  <code>SpxTradeAlerts</code>
                </td>
                <td>
                  <code>useSpxPlay</code> 3s
                </td>
                <td>Play state, gates, option ticket</td>
              </tr>
              <tr>
                <td>Commentary</td>
                <td>
                  <code>SpxCommentaryRail</code>
                </td>
                <td>POST on desk deltas</td>
                <td>15s check, 55s min gap</td>
              </tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Session guards (three independent systems)</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Guard</th>
                <th>Scope</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pulse / flow lane</td>
                <td>Server builders</td>
                <td>
                  RTH or premarket planning; flow uses <code>fetchMarketStatusNow()</code> for holidays (Fix 7)
                </td>
              </tr>
              <tr>
                <td>Client polling</td>
                <td>
                  <code>useMergedDesk</code>
                </td>
                <td>Stops when <code>market_open=false</code> and not premarket</td>
              </tr>
              <tr>
                <td>Play engine</td>
                <td>
                  <code>spx-play-engine</code>
                </td>
                <td>7:00–16:00 ET cron; no-entry 3:30 PM; force-exit 3:50 PM</td>
              </tr>
              <tr>
                <td>Lotto</td>
                <td>
                  <code>spx-lotto-engine</code>
                </td>
                <td>7:00–10:30 ET only; parallel to main play</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            <strong>Asymmetry:</strong> Full desk (<code>buildSpxDesk</code>) has no after-hours empty guard — it
            still builds with Polygon data after close. Pulse/flow return empty in extended hours. Desk can show live
            price while pulse/flow lanes are empty.
          </p>
        </section>

        <section className="docs-section">
          <h2>4. Play engine — decision pipeline</h2>
          <pre className="docs-diagram">{`Merged desk + technicals
        ↓
computeSpxConfluence()      ← pure (spx-signals.ts)
        ↓
evaluatePlayGates()         ← VWAP, gamma, time, adaptive floors
        ↓
evaluatePlayConfirmations() ← flow alignment, tape, internals
        ↓
evaluateClaudePlayApproval()← optional LLM gate (platform_meta cache)
        ↓
FSM: SCANNING → WATCHING → OPEN (BUY/HOLD/TRIM/SELL)
        ↓
spx_open_play + spx_play_outcomes + spx_signal_log`}</pre>
          <p>
            <strong>Parallel engine:</strong> Lotto FSM (<code>spx_lotto_record</code> in <code>platform_meta</code>)
            runs 7:00–10:30 ET and never consumes the main <code>spx_open_play</code> slot.
          </p>
          <p>
            <strong>Production requirement:</strong> <code>DATABASE_URL</code> must be set. Without it,{" "}
            <code>/spx/play</code> returns 503 via <code>requireDatabaseInProduction()</code>.
          </p>
          <p>
            <strong>Client:</strong> <code>useSpxPlay</code> polls every 3s during <code>sessionActive</code>, caches
            in sessionStorage, merges stale confirmation layers to prevent UI flicker.
          </p>
        </section>

        <section className="docs-section">
          <h2>5. Flow system — ingest, persistence, live tape</h2>
          <pre className="docs-diagram">{`UW flow_alerts
    │
    ├─ WS path (uw-socket)
    │     └─ publishFlowEvent() → SSE only (no Postgres)
    │
    └─ REST path (flow-ingest, ~45s cron)
          └─ insertFlowAlert() → Postgres + publishFlowEvent()

flow-events.ts (in-process Set) → /api/market/flows/stream → useLiveSpxTape`}</pre>
          <p className="docs-note">
            <strong>Critical split:</strong> When UW WS <code>flow_alerts</code> is OPEN, REST cron{" "}
            <strong>skips entirely</strong>. Live SSE can work while Postgres history goes stale. WS path does not
            call <code>insertFlowAlert</code>.
          </p>
          <p className="docs-note">
            <strong>Multi-instance:</strong> <code>flow-events.ts</code> is per-process. SSE clients on instance B
            never see events published on instance A.
          </p>
        </section>

        <section className="docs-section">
          <h2>6. WebSocket layer</h2>
          <h3 className="docs-subheading">Polygon indices (<code>polygon-socket.ts</code>)</h3>
          <ul className="docs-list">
            <li>
              <code>indexStore</code> with <code>session_open</code> for day-% (Fix 2)
            </li>
            <li>Merged into pulse when fresh &lt;5s via <code>mergeWsIndexSnapshots</code>
            </li>
            <li>
              <code>/pulse/stream</code> SSE pushes every 250ms — <strong>built, no client consumer</strong>
            </li>
            <li>Server-side only; browser never connects to Polygon directly</li>
          </ul>

          <h3 className="docs-subheading">UW (<code>uw-socket.ts</code>)</h3>
          <ul className="docs-list">
            <li>Channels: <code>flow_alerts</code>, <code>market_tide</code>, <code>off_lit_trades</code>
            </li>
            <li>Auth: <code>{'{"action":"auth","key":"UW_API_KEY"}'}</code> (Fix 1)</li>
            <li>Dark pool: <code>normalizeDarkPoolWsPayload()</code> (Fix 3)</li>
            <li>
              If WS fails → REST fallback in desk builders (slower, more quota, but functional)
            </li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>7. Caching — four tiers</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Mechanism</th>
                <th>Scope</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1. Server cache</td>
                <td>
                  <code>withServerCache</code>
                </td>
                <td>Per process</td>
                <td>Dedup inflight; 1s / 2s / 10s desk lanes</td>
              </tr>
              <tr>
                <td>2. Redis</td>
                <td>
                  <code>shared-cache.ts</code>
                </td>
                <td>Cross-instance if <code>REDIS_URL</code>
                </td>
                <td>Sticky GEX, tape, flow briefs</td>
              </tr>
              <tr>
                <td>3. Module sticky</td>
                <td>
                  <code>lastGood*</code> in <code>spx-desk.ts</code>
                </td>
                <td>Per process</td>
                <td>Survive UW 429s / slow fetches</td>
              </tr>
              <tr>
                <td>4. Client cache</td>
                <td>SWR + sessionStorage</td>
                <td>Per browser tab</td>
                <td>Smooth UI across navigation</td>
              </tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Key TTLs</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Cache</th>
                <th>Default</th>
                <th>Env override</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Full desk lane</td>
                <td>10s</td>
                <td>
                  <code>SPX_DESK_CACHE_SEC</code>
                </td>
              </tr>
              <tr>
                <td>Pulse lane</td>
                <td>1s</td>
                <td>
                  <code>SPX_PULSE_CACHE_SEC</code>
                </td>
              </tr>
              <tr>
                <td>Flow lane</td>
                <td>2s</td>
                <td>
                  <code>SPX_FLOW_CACHE_SEC</code>
                </td>
              </tr>
              <tr>
                <td>Pulse structure (EMAs, VWAP)</td>
                <td>5s</td>
                <td>
                  <code>SPX_PULSE_STRUCTURE_SEC</code>
                </td>
              </tr>
              <tr>
                <td>Market status (Fix 4)</td>
                <td>60s</td>
                <td>hardcoded in <code>polygon.ts</code>
                </td>
              </tr>
              <tr>
                <td>Polygon 0DTE GEX bundle</td>
                <td>15s</td>
                <td>
                  <code>SPX_POLYGON_GEX_CACHE_SEC</code>
                </td>
              </tr>
              <tr>
                <td>Redis sticky GEX</td>
                <td>120s</td>
                <td>
                  <code>SPX_REDIS_GEX_TTL_SEC</code>
                </td>
              </tr>
              <tr>
                <td>Redis sticky tape</td>
                <td>60s</td>
                <td>
                  <code>SPX_REDIS_TAPE_TTL_SEC</code>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>8. Secondary products</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Data path</th>
                <th>Poll / trigger</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Largo</td>
                <td>
                  <code>loadMergedSpxDesk()</code> + Anthropic tool loop (75 tools, intent-filtered)
                </td>
                <td>On-demand POST</td>
                <td>
                  <code>largo_sessions</code>, <code>largo_messages</code>
                </td>
              </tr>
              <tr>
                <td>Night Hawk</td>
                <td>Polygon + UW + Finnhub dossiers → Anthropic synthesis</td>
                <td>Cron ~5:30 PM ET; client 120s</td>
                <td>
                  <code>nighthawk_editions</code>
                </td>
              </tr>
              <tr>
                <td>HELIX</td>
                <td>REST seed + SSE; 30s REST fallback</td>
                <td>SSE primary</td>
                <td>
                  <code>flow_alerts</code> table
                </td>
              </tr>
              <tr>
                <td>Admin</td>
                <td>Engine telemetry + API Command Center probes</td>
                <td>30s / 10s live tab</td>
                <td>Read-only analytics</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>9. Auth, tiers, and security</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Enforcement</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pages</td>
                <td>
                  Clerk sign-in + <code>requireTier(&quot;premium&quot;)</code> → redirect <code>/upgrade</code>
                </td>
              </tr>
              <tr>
                <td>Middleware</td>
                <td>
                  Protects <code>/dashboard</code>, <code>/flows</code>, <code>/terminal</code>,{" "}
                  <code>/heatmap</code>, <code>/nighthawk</code>, <code>/admin</code>, <code>/docs</code>
                </td>
              </tr>
              <tr>
                <td>Play / lotto / Largo / Night Hawk APIs</td>
                <td>
                  <code>authorizeCronOrTierApi(&quot;premium&quot;)</code> or <code>CRON_SECRET</code>
                </td>
              </tr>
              <tr>
                <td>Desk / pulse / flow / merged / flows / SSE</td>
                <td>
                  <strong>No API auth</strong> — publicly callable if URL is known
                </td>
              </tr>
              <tr>
                <td>Commentary</td>
                <td>Clerk sign-in only (not premium-gated at API)</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            <strong>Gap:</strong> Premium is enforced at page render, not on core market data APIs. Cron auth uses{" "}
            <code>CRON_SECRET</code> via Bearer or <code>?secret=</code>. <code>railway.toml</code> has no cron
            definitions — schedules must be configured in Railway dashboard.
          </p>
        </section>

        <section className="docs-section">
          <h2>10. Postgres state map</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Table / key</th>
                <th>Owner</th>
                <th>Multi-instance safe?</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>spx_open_play</code>
                </td>
                <td>Play engine</td>
                <td>Mostly — last writer wins on races</td>
              </tr>
              <tr>
                <td>
                  <code>spx_play_outcomes</code>
                </td>
                <td>Play telemetry</td>
                <td>Yes (append)</td>
              </tr>
              <tr>
                <td>
                  <code>platform_meta.spx_play_session_meta</code>
                </td>
                <td>Cooldowns</td>
                <td>Race-prone</td>
              </tr>
              <tr>
                <td>
                  <code>platform_meta.spx_lotto_record</code>
                </td>
                <td>Lotto FSM</td>
                <td>Race-prone</td>
              </tr>
              <tr>
                <td>
                  <code>flow_alerts</code>
                </td>
                <td>Flow ingest</td>
                <td>Yes (<code>ON CONFLICT DO NOTHING</code>)</td>
              </tr>
              <tr>
                <td>
                  <code>spx_signal_log</code>
                </td>
                <td>Signal audit</td>
                <td>Weak dedup (confidence in key)</td>
              </tr>
              <tr>
                <td>
                  <code>nighthawk_editions</code>
                </td>
                <td>Night Hawk</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>
                  <code>largo_sessions</code>
                </td>
                <td>Largo</td>
                <td>Yes</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>11. Railway deployment</h2>
          <p>
            From <code>railway.toml</code>: build uses <code>DATABASE_PUBLIC_URL</code>; start{" "}
            <code>next start -H 0.0.0.0 -p $PORT</code>; healthcheck <code>/</code> (not{" "}
            <code>/api/market/health</code>). No horizontal scaling config, no cron definitions, no sticky sessions.
          </p>

          <h3 className="docs-subheading">Multi-instance risks (if Railway scales &gt;1)</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Severity</th>
                <th>Symptom</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>SSE flow tape on wrong instance</td>
                <td>Critical</td>
                <td>Tape silent for some users</td>
              </tr>
              <tr>
                <td>Dual play evaluation</td>
                <td>Critical</td>
                <td>Conflicting BUY/SELL decisions</td>
              </tr>
              <tr>
                <td>Polygon/UW quota × N instances</td>
                <td>High</td>
                <td>429 cascades</td>
              </tr>
              <tr>
                <td>WS on one instance, REST skipped per process</td>
                <td>High</td>
                <td>DB flow history gaps</td>
              </tr>
              <tr>
                <td>
                  <code>lastPulseForSignals</code> not Redis-synced
                </td>
                <td>Medium</td>
                <td>Different play scores per instance</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>12. UI — mounted vs orphaned</h2>
          <h3 className="docs-subheading">Production dashboard (mounted)</h3>
          <p>
            <code>SpxDashboard</code> → <code>SpxSniperHeader</code>, <code>SpxIntelStrip</code>,{" "}
            <code>SpxDarkPoolCard</code>, <code>SpxGexLadder</code>, <code>SpxUnifiedTape</code>,{" "}
            <code>SpxTradeAlerts</code>, <code>SpxCommentaryRail</code>
          </p>

          <h3 className="docs-subheading">Orphaned (built, not wired to /dashboard)</h3>
          <ul className="docs-list">
            <li>
              <code>SpxTechnicalsPanel</code>, <code>SpxChart</code>, <code>SpxStructureBlocks</code>,{" "}
              <code>OdteFlowBar</code>
            </li>
            <li>
              <code>GexDealerPanel</code>, <code>Flow0dtePanel</code>, <code>BreadthPanel</code>,{" "}
              <code>BenzingaNewsRail</code>
            </li>
            <li>
              <code>SpxLiveStrip</code> (would duplicate entire <code>useMergedDesk</code> stack)
            </li>
            <li>
              <code>LiveMarketPulse</code> embed (polls <code>/spx/merged</code> at 3s — alternate architecture)
            </li>
            <li>
              <code>createFlowSocket()</code> — deprecated engine WebSocket, never called
            </li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>13. Recent fixes (2026-06-18)</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>File</th>
                <th>Fix</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>
                  <code>uw-socket.ts</code>
                </td>
                <td>UW auth <code>token</code> → <code>key</code>
                </td>
                <td>Code landed — verify on Railway logs</td>
              </tr>
              <tr>
                <td>2</td>
                <td>
                  <code>polygon-socket.ts</code>
                </td>
                <td>
                  <code>change_pct</code> uses <code>session_open</code> baseline
                </td>
                <td>✅ Verified</td>
              </tr>
              <tr>
                <td>3</td>
                <td>
                  <code>unusual-whales.ts</code>
                </td>
                <td>
                  <code>normalizeDarkPoolWsPayload()</code> + typed <code>darkPoolStore</code>
                </td>
                <td>✅ Code landed</td>
              </tr>
              <tr>
                <td>4</td>
                <td>
                  <code>polygon.ts</code>
                </td>
                <td>
                  <code>fetchMarketStatusNow()</code> 60s cache
                </td>
                <td>✅ Verified (~23k → ~390 calls/day per instance)</td>
              </tr>
              <tr>
                <td>5</td>
                <td>
                  <code>desk/route.ts</code>
                </td>
                <td>
                  <code>ensureDataSockets()</code> + <code>staleWhileRevalidate: false</code>
                </td>
                <td>✅ Verified</td>
              </tr>
              <tr>
                <td>6</td>
                <td>
                  <code>spx-desk.ts</code>
                </td>
                <td>
                  <code>buildSpxDesk()</code> fetches fresh flows via <code>fetchSpxDeskFlowAlertsWithDb(32)</code>
                </td>
                <td>✅ Verified (32 flows / 32 tape on desk)</td>
              </tr>
              <tr>
                <td>7</td>
                <td>
                  <code>spx-desk.ts</code>
                </td>
                <td>Flow lane uses <code>fetchMarketStatusNow()</code> + holiday guard
                </td>
                <td>✅ Verified</td>
              </tr>
              <tr>
                <td>8</td>
                <td>
                  <code>pulse/stream/route.ts</code>
                </td>
                <td>SSE <code>cancel()</code> + try/catch self-stop
                </td>
                <td>✅ Verified</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>14. Open issues register</h2>

          <h3 className="docs-subheading">Critical</h3>
          <ul className="docs-list">
            <li>
              <strong>UW WebSocket 1006</strong> — REST works; WS auth/connect still failing in some environments;
              Railway deploy is definitive test
            </li>
            <li>
              <strong>WS → no Postgres</strong> — live SSE without DB persistence when WS suppresses REST ingest
            </li>
            <li>
              <strong>In-memory flow pub/sub</strong> — breaks multi-instance SSE
            </li>
            <li>
              <strong>
                <code>lastPulseForSignals</code> not Redis-synced
              </strong>{" "}
              — play engine divergence across instances
            </li>
            <li>
              <strong>Pulse SSE unused</strong> — 250ms server stream exists; client still polls REST at 1s
            </li>
          </ul>

          <h3 className="docs-subheading">High</h3>
          <ul className="docs-list">
            <li>API auth gap — desk/flow/SSE publicly callable</li>
            <li>Desk vs pulse session asymmetry after hours</li>
            <li>Dark pool date filter — ET string prefix, not session-aware</li>
            <li>Whale vs 0DTE route priority — $1M+ 0DTE classified as whale</li>
            <li>VIX contango logic too strict</li>
            <li>~10 orphan UI panels not on dashboard</li>
            <li>No distributed cron leader for horizontal scale</li>
          </ul>

          <h3 className="docs-subheading">Medium</h3>
          <ul className="docs-list">
            <li>Signal dedup uses raw confidence float</li>
            <li>Flow ingest lock semantics (<code>lastIngestAt</code> after completion)</li>
            <li>Cold-start duplicate flow paths (REST + WS + flow lane)</li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>15. Operational checklist (Railway)</h2>
          <h3 className="docs-subheading">Must have</h3>
          <ul className="docs-list">
            <li>
              <code>POLYGON_API_KEY</code>
            </li>
            <li>
              <code>UW_API_KEY</code>
            </li>
            <li>
              <code>DATABASE_URL</code>
            </li>
            <li>
              <code>CRON_SECRET</code>
            </li>
            <li>
              <code>ANTHROPIC_API_KEY</code>
            </li>
            <li>Clerk keys</li>
          </ul>

          <h3 className="docs-subheading">Strongly recommended</h3>
          <ul className="docs-list">
            <li>
              <code>REDIS_URL</code>
            </li>
            <li>Single instance OR sticky sessions until pub/sub + engine locks fixed</li>
            <li>
              Cron: <code>spx-evaluate</code> (1–3 min RTH), <code>flow-ingest</code> (~45s),{" "}
              <code>nighthawk-edition</code> (daily ~5:30 PM ET)
            </li>
          </ul>

          <h3 className="docs-subheading">Deploy verification logs</h3>
          <pre className="docs-code">{`[uw-socket] connected: flow_alerts
[uw-socket] connected: market_tide
[uw-socket] connected: off_lit_trades
[polygon-socket] indices authenticated — subscribing`}</pre>
        </section>

        <section className="docs-section">
          <h2>16. E2E test summary (local, 2026-06-18)</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>tsc --noEmit</code>
                </td>
                <td>✅ Clean</td>
              </tr>
              <tr>
                <td>
                  <code>npm run build</code>
                </td>
                <td>✅ 33 pages, all SPX routes present</td>
              </tr>
              <tr>
                <td>Polygon REST probe</td>
                <td>✅ 30/34 (4 plan-limited 404s)</td>
              </tr>
              <tr>
                <td>
                  <code>/spx/desk</code>
                </td>
                <td>✅ SPX price, GEX walls, 32 flows / 32 tape</td>
              </tr>
              <tr>
                <td>
                  <code>/spx/pulse</code> / <code>/spx/flow</code>
                </td>
                <td>✅ Empty in extended hours (expected)</td>
              </tr>
              <tr>
                <td>
                  <code>/spx/play</code>
                </td>
                <td>⚠️ 503 without <code>DATABASE_URL</code> (prod guard)</td>
              </tr>
              <tr>
                <td>Pulse SSE</td>
                <td>✅ 6 chunks in 1.2s</td>
              </tr>
              <tr>
                <td>Market status cache</td>
                <td>✅ Pulse back-to-back 603ms → 4ms → 2ms</td>
              </tr>
              <tr>
                <td>UW + Polygon WS</td>
                <td>❌ 1006 locally (REST OK)</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            Reusable probe: <code>scripts/e2e-spx-probe.mjs</code>
          </p>
        </section>

        <section className="docs-section">
          <h2>17. Prioritized roadmap</h2>

          <h3 className="docs-subheading">Tier 0 — Production stability (before scaling instances)</h3>
          <ol className="docs-ordered">
            <li>Confirm UW WS on Railway (Fix 1 validation)</li>
            <li>Wire WS flow alerts → <code>insertFlowAlert</code> (or keep REST cron when WS up)</li>
            <li>Redis pub/sub for <code>flow-events</code> (or enforce single instance)</li>
            <li>Redis-sync <code>lastPulseForSignals</code>
            </li>
          </ol>

          <h3 className="docs-subheading">Tier 1 — Live UX</h3>
          <ol className="docs-ordered">
            <li>Wire client to <code>/pulse/stream</code> SSE (replace 1s REST poll)</li>
            <li>Mount <code>SpxTechnicalsPanel</code> or fold technicals into TradeAlerts</li>
            <li>Fix dark pool ET session date filter</li>
            <li>API auth on desk/flow/SSE endpoints (match page tier)</li>
          </ol>

          <h3 className="docs-subheading">Tier 2 — Engine correctness</h3>
          <ol className="docs-ordered">
            <li>Distributed lock for <code>spx-evaluate</code> cron</li>
            <li>0DTE route priority over whale in flow parser</li>
            <li>VIX contango logic relaxation</li>
            <li>Signal dedup confidence bucketing</li>
          </ol>

          <h3 className="docs-subheading">Tier 3 — Platform polish</h3>
          <ol className="docs-ordered">
            <li>Mount orphan panels or delete dead components</li>
            <li>
              <code>npm run e2e:spx</code> in CI
            </li>
            <li>Railway healthcheck → <code>/api/market/health</code>
            </li>
            <li>Cron definitions in Railway runbook</li>
          </ol>
        </section>

        <section className="docs-section">
          <h2>18. Key source files</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Area</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Dashboard UI</td>
                <td>
                  <code>src/components/SpxDashboard.tsx</code>, <code>src/components/desk/*</code>
                </td>
              </tr>
              <tr>
                <td>Client hooks</td>
                <td>
                  <code>src/hooks/useMergedDesk.ts</code>, <code>useSpxPlay.ts</code>,{" "}
                  <code>useLiveSpxTape.ts</code>
                </td>
              </tr>
              <tr>
                <td>Desk builders</td>
                <td>
                  <code>src/lib/providers/spx-desk.ts</code>
                </td>
              </tr>
              <tr>
                <td>Desk loader</td>
                <td>
                  <code>src/lib/spx-desk-loader.ts</code>
                </td>
              </tr>
              <tr>
                <td>Play engine</td>
                <td>
                  <code>src/lib/spx-play-engine.ts</code>, <code>spx-signals.ts</code>
                </td>
              </tr>
              <tr>
                <td>Flow ingest</td>
                <td>
                  <code>src/lib/providers/flow-ingest.ts</code>
                </td>
              </tr>
              <tr>
                <td>SSE pub/sub</td>
                <td>
                  <code>src/lib/flow-events.ts</code>
                </td>
              </tr>
              <tr>
                <td>WebSockets</td>
                <td>
                  <code>src/lib/ws/polygon-socket.ts</code>, <code>uw-socket.ts</code>,{" "}
                  <code>init-data-sockets.ts</code>
                </td>
              </tr>
              <tr>
                <td>API routes</td>
                <td>
                  <code>
                    {"src/app/api/market/spx/{pulse,flow,desk,play,merged,pulse/stream}/route.ts"}
                  </code>
                </td>
              </tr>
              <tr>
                <td>Cron</td>
                <td>
                  <code>
                    {"src/app/api/cron/{spx-evaluate,flow-ingest,nighthawk-edition,largo-cleanup}/route.ts"}
                  </code>
                </td>
              </tr>
              <tr>
                <td>Cache config</td>
                <td>
                  <code>src/lib/providers/config.ts</code>, <code>server-cache.ts</code>,{" "}
                  <code>shared-cache.ts</code>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>19. Bottom line</h2>
          <p>
            The architecture is sound: three-lane desk merge, separate play FSM, parallel lotto, provider fallback
            chains, sticky resilience under UW 429s, and a full admin telemetry layer. Recent fixes addressed market
            status spam, stale desk cache, holiday guards, dark pool WS shape, and SSE cleanup.
          </p>
          <p>
            The biggest systemic risks are <strong>distributed systems gaps</strong> — in-process SSE pub/sub, WS
            without DB persistence, ungated market APIs, engine state races without leader election, and the client
            not using the fastest data path already built (<code>/pulse/stream</code>).
          </p>
          <p>
            <strong>Locally:</strong> build is clean; desk pipeline is healthy; Polygon REST works; UW REST works; both
            WS layers hit 1006 from the dev environment. <strong>Railway deploy</strong> is the definitive test for
            WebSocket auth and live tape.
          </p>
        </section>
      </main>
    </div>
  );
}
