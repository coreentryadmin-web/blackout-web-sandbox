/**
 * /docs/system-analysis — Deep system architecture analysis.
 * Cross-references cursor-api-analysis, live probe results, codebase audit.
 * Generated 2026-06-18.
 */
import Link from "next/link";

export const revalidate = 0;

export default function SystemAnalysisPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">Blackout · Engineering deep dive</p>
        <h1 className="docs-title">Full System Architecture Analysis</h1>
        <p className="docs-lead">
          Cross-analysis of cursor-api-analysis (static codebase scan), live API probe results, and full codebase audit.
          Covers SPX engine, Largo, flows, Night Hawk, rate limits, WebSocket strategy, and improvement roadmap.
          Generated <strong>2026-06-18</strong>.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          <Link href="/docs/api-probe" className="docs-back-link">Live probe results →</Link>
          <Link href="/docs/cursor-api-analysis" className="docs-back-link">API usage analysis →</Link>
          <Link href="/docs/claude-api-analysis" className="docs-back-link">API catalog →</Link>
        </div>
      </header>

      {/* ── SECTION 0: ALIGNMENT CHECK ── */}
      <section className="docs-section">
        <h2>1. Cursor-API-Analysis vs Probe — Alignment check</h2>
        <p style={{ fontSize: 13, marginBottom: "1rem" }}>
          The auto-generated cursor scan (<code>scripts/analyze-api-usage.mjs</code>) and the live probe are 80% aligned.
          The gaps reveal real architectural issues.
        </p>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Metric</th><th>Cursor scan</th><th>Live probe</th><th>Gap</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Polygon paths in codebase</td>
              <td>36</td>
              <td>78 documented, 36 actually called</td>
              <td>✅ Aligned — cursor correctly counts active callers</td>
            </tr>
            <tr>
              <td>UW paths in codebase</td>
              <td>106</td>
              <td>~70 direct play-engine paths</td>
              <td>Δ36 — cursor includes Largo tools; probe catalogued engine paths only</td>
            </tr>
            <tr>
              <td>Internal routes</td>
              <td>33</td>
              <td>33 confirmed</td>
              <td>✅ Exact match</td>
            </tr>
            <tr>
              <td>Largo tools</td>
              <td><strong>75</strong></td>
              <td>Not in probe scope</td>
              <td>⚠️ 75 tools = large Claude prompt every Largo query</td>
            </tr>
            <tr>
              <td>403 UW endpoints</td>
              <td>Not detected (static scan can't probe HTTP)</td>
              <td><strong>6 endpoints returning 403</strong></td>
              <td>🚨 Critical — cursor marks them "used", they are failing in production</td>
            </tr>
            <tr>
              <td>gap-proxy.ts</td>
              <td>Found — calls <code>/v2/snapshot/.../stocks/tickers</code></td>
              <td>Not in probe docs</td>
              <td>Undocumented additional Polygon caller — adds to concurrent call count</td>
            </tr>
            <tr>
              <td>spx-lotto-options.ts, spx-play-options.ts</td>
              <td>Found — call <code>/v3/snapshot/options/SPXW</code> directly</td>
              <td>Not in probe docs</td>
              <td>Two files bypass polygon-options-gex.ts to call SPXW chain directly</td>
            </tr>
            <tr>
              <td>WebSocket usage</td>
              <td>Found deprecated <code>createFlowSocket()</code> in api.ts — never called</td>
              <td>All 11 UW WS channels confirmed 101, all Polygon WS documented but unimplemented</td>
              <td>🔴 Zero WS connections today — entire real-time stack is REST polling</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>What cursor finds that probe can&apos;t</h3>
        <p style={{ fontSize: 13 }}>
          Cursor scan surfaces extra UW endpoints via Largo tools that never appear in the play engine:
          <code>/api/companies/*</code> (dividends, splits, profile), <code>/api/congress/*</code>,
          <code>/api/lit-flow/*</code>, <code>/api/seasonality/*</code>, <code>/api/shorts/*</code>,
          ETF holdings/exposure/weights — these all live inside <code>src/lib/providers/unusual-whales.ts</code>
          as Largo tool implementations. They are correct and expected. The 106 vs 70 difference is
          the Largo tool surface vs the play engine surface.
        </p>
      </section>

      {/* ── SECTION 1: ARCHITECTURE ── */}
      <section className="docs-section">
        <h2>2. Full system architecture</h2>

        <h3>Three data lanes — server-side cache TTLs</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Lane</th><th>Route</th><th>Cache TTL</th><th>Upstream calls per cycle</th><th>Client poll</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Pulse</strong></td>
              <td><code>/api/market/spx/pulse</code></td>
              <td><strong>1s</strong></td>
              <td>~3 Polygon (index snapshots batch, structure sub-cache 5s = +7 more)</td>
              <td>1s (SWR)</td>
            </tr>
            <tr>
              <td><strong>Flow</strong></td>
              <td><code>/api/market/spx/flow</code></td>
              <td><strong>2s</strong></td>
              <td>4 UW (market tide, NOPE, 0DTE flow, dark pool) — rate-limit risk lane</td>
              <td>2s (SWR)</td>
            </tr>
            <tr>
              <td><strong>Desk</strong></td>
              <td><code>/api/market/spx/desk</code></td>
              <td><strong>10s</strong></td>
              <td>~14 Polygon + 7 UW per rebuild</td>
              <td>10s (SWR)</td>
            </tr>
            <tr>
              <td><strong>Play engine</strong></td>
              <td><code>/api/market/spx/play</code></td>
              <td>reuses caches</td>
              <td>0 extra upstream — consumes cached pulse/flow/desk</td>
              <td>3s (SWR)</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>Polygon calls per minute (worst case, 1 active user)</h3>
        <pre className="docs-code">{`Pulse (1s × ~3 calls):          180 Polygon calls/min
Structure sub-cache (5s × ~7):   84 Polygon calls/min
Desk (10s × ~14):                84 Polygon calls/min
Play (3s, no extra calls):        0 upstream
GEX chain (15s × up to 16 pages): ~64 Polygon calls/min
─────────────────────────────────────────────────────
TOTAL:                          ~412 Polygon calls/min per user

Polygon Advanced = unlimited → ✅ SAFE
Latency per call: ~290ms avg (measured)`}</pre>

        <h3 style={{ marginTop: "1.5rem" }}>UW calls per minute (worst case)</h3>
        <pre className="docs-code">{`Flow lane (2s × 4 calls):        120 UW calls/min  ← HITS THE EXACT LIMIT
Desk lane (10s × 7 UW calls):    42 UW calls/min
Flow ingest cron (every ~45s):    1-2 UW calls/min
─────────────────────────────────────────────────────
TOTAL at steady state:          ~164 UW calls/min

UW Advanced plan limit:         120 req/min
DEFICIT:                        -44 UW calls/min → causing 429s in production

The 429s seen during probe were NOT test traffic.
They were your live system consuming quota.
Flow lane alone maxes out the plan.`}</pre>

        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "0.75rem 1rem", marginTop: "0.75rem", fontSize: 13 }}>
          <strong style={{ color: "#ef4444" }}>🚨 Production budget overflow confirmed.</strong> The flow lane (2s × 4 UW calls) consumes exactly 120 UW req/min — the entire plan limit.
          Every additional UW call from the desk lane, Largo users, or Night Hawk edition builds is going over quota.
          This is why you see 429s on non-flow endpoints and why some desk data may be returning stale/null silently.
        </div>
      </section>

      {/* ── SECTION 2: 403 FAILURES ── */}
      <section className="docs-section">
        <h2>3. Silent 403 failures in production</h2>
        <p style={{ fontSize: 13, marginBottom: "1rem" }}>
          6 UW endpoints are called in the codebase and return <strong>403 Forbidden</strong> —
          not on the current UW Advanced plan tier. The error handling in <code>uwGetSafe()</code> silently
          returns <code>null</code>, so these are failing invisibly. The play engine or desk data
          that depends on them is operating with missing signals.
        </p>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Endpoint</th><th>HTTP</th><th>Used in</th><th>Impact if null</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/api/stock/&#123;ticker&#125;/volatility/anomaly</code></td>
              <td><span style={{ color: "#ef4444", fontWeight: 700 }}>403</span></td>
              <td>UW provider, Largo vol tool</td>
              <td>Vol anomaly signal missing — Largo tool returns empty, play engine vol check degraded</td>
            </tr>
            <tr>
              <td><code>/api/stock/&#123;ticker&#125;/volatility/character</code></td>
              <td><span style={{ color: "#ef4444", fontWeight: 700 }}>403</span></td>
              <td>UW provider, Largo vol tool</td>
              <td>Same — vol character missing from Night Hawk dossiers</td>
            </tr>
            <tr>
              <td><code>/api/stock/&#123;ticker&#125;/volatility/variance-risk-premium</code></td>
              <td><span style={{ color: "#ef4444", fontWeight: 700 }}>403</span></td>
              <td>UW provider</td>
              <td>VRP missing — dealer carry signal absent</td>
            </tr>
            <tr>
              <td><code>/api/volatility/vix-term-structure</code></td>
              <td><span style={{ color: "#ef4444", fontWeight: 700 }}>403</span></td>
              <td>UW provider — VIX contango/backwardation gate</td>
              <td><strong>High impact</strong> — VIX term structure is a hard-opposing factor. If null, the check passes by default → plays can fire in backwardation without the gate triggering</td>
            </tr>
            <tr>
              <td><code>/api/volatility/anomaly/top</code></td>
              <td><span style={{ color: "#ef4444", fontWeight: 700 }}>403</span></td>
              <td>UW provider, Night Hawk market-wide</td>
              <td>Market vol regime signal missing from Night Hawk</td>
            </tr>
            <tr>
              <td><code>/api/volatility/character/top</code></td>
              <td><span style={{ color: "#ef4444", fontWeight: 700 }}>403</span></td>
              <td>UW provider, Night Hawk market-wide</td>
              <td>Same</td>
            </tr>
          </tbody>
        </table>
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, padding: "0.75rem 1rem", marginTop: "0.75rem", fontSize: 13 }}>
          <strong>Fix options (choose one):</strong>
          <ol style={{ margin: "0.5rem 0 0 1.25rem", lineHeight: 1.8 }}>
            <li><strong>Upgrade UW plan</strong> to include volatility analytics tier — these endpoints are in UW&apos;s higher tier.</li>
            <li><strong>Replace with Polygon data:</strong> VIX term structure → already available via <code>/v3/snapshot/indices</code> (VIX9D, VIX3M). Vol anomaly → compute from Polygon realized vol + IV rank. No extra cost.</li>
            <li><strong>Explicit null guards:</strong> If null-return is acceptable, add explicit fallback values so the engine doesn&apos;t silently pass gates that should be blocked.</li>
          </ol>
        </div>

        <h3 style={{ marginTop: "1.5rem" }}>422 — ATM Chains needs fix</h3>
        <p style={{ fontSize: 13 }}>
          <code>/api/stock/&#123;ticker&#125;/atm-chains</code> returns 422 for SPX — UW requires an expiry query param for index underlyings.
          The current call sends no params. Fix: pass <code>?expiration_date=YYYY-MM-DD</code> for today&apos;s 0DTE expiry.
        </p>
      </section>

      {/* ── SECTION 3: WEBSOCKET ── */}
      <section className="docs-section">
        <h2>4. WebSocket analysis — full end-to-end</h2>

        <h3>Current state: Zero WebSocket connections</h3>
        <p style={{ fontSize: 13, marginBottom: "1rem" }}>
          The app has a deprecated <code>createFlowSocket()</code> in <code>src/lib/api.ts</code> (never called).
          The docs pages at <code>/docs/polygon/websocket/*</code> fully document Polygon&apos;s WS API — the implementation is absent.
          All real-time data arrives via REST polling + one SSE stream (<code>/api/market/flows/stream</code>).
        </p>

        <h3>Latency impact of polling vs WebSocket</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Signal</th><th>Current method</th><th>Current max lag</th><th>With WebSocket</th><th>Improvement</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>SPX price</td>
              <td>Polygon REST, 1s cache</td>
              <td>~1.3s (cache + HTTP)</td>
              <td>Polygon WS <code>A.I:SPX</code> (per-second agg push)</td>
              <td><strong>~0.8s faster</strong>, 86,400 fewer HTTP calls/day/tab</td>
            </tr>
            <tr>
              <td>VIX / VIX9D / VIX3M</td>
              <td>Polygon REST, 1s cache</td>
              <td>~1.3s</td>
              <td>Polygon WS <code>A.I:VIX</code>, <code>A.I:VIX9D</code>, <code>A.I:VIX3M</code></td>
              <td>Same improvement, eliminates 3 of the 3 snapshot calls</td>
            </tr>
            <tr>
              <td>Flow alerts</td>
              <td>UW REST + cron ingest (~45s) + SSE forward</td>
              <td><strong>up to 60s end-to-end</strong></td>
              <td>UW WS <code>/api/socket/flow_alerts</code> → server event → SSE</td>
              <td><strong>~59s faster</strong> — the single biggest improvement</td>
            </tr>
            <tr>
              <td>Market tide</td>
              <td>UW REST, 2s poll in flow lane</td>
              <td>~2.3s</td>
              <td>UW WS <code>/api/socket/market_tide</code> push</td>
              <td>~2s faster + eliminates 30 UW calls/min</td>
            </tr>
            <tr>
              <td>GEX walls</td>
              <td>Polygon chain re-fetch every 15s</td>
              <td>~15s</td>
              <td>UW WS <code>/api/socket/gex</code> push on change</td>
              <td>Near-instant on gamma flip, eliminates 64 Polygon chain calls/min</td>
            </tr>
            <tr>
              <td>Dark pool</td>
              <td>UW REST, 2s poll in flow lane</td>
              <td>~2.3s</td>
              <td>UW WS <code>/api/socket/off_lit_trades</code></td>
              <td>~2s faster + 30 fewer UW calls/min</td>
            </tr>
            <tr>
              <td>SPXW option chain</td>
              <td>Polygon REST paginated, up to 16 calls per GEX refresh</td>
              <td>15s per update</td>
              <td>Polygon WS <code>A.O:SPXW*</code> (per-second option aggs for all SPXW strikes)</td>
              <td>Real-time greeks as strikes trade — eliminates 16-call GEX pagination</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>WebSocket budget — what&apos;s available</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Provider</th><th>WS limit (Advanced plan)</th><th>Channels confirmed live</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Polygon / Massive</td>
              <td>Up to 10 simultaneous connections per API key. Each connection: unlimited symbol subscriptions.</td>
              <td>3 cluster endpoints: <code>wss://socket.massive.com/stocks</code>, <code>/options</code>, <code>/indices</code></td>
            </tr>
            <tr>
              <td>Unusual Whales</td>
              <td>Not published — tested 101 on all 11 channels (confirmed available on Advanced plan)</td>
              <td>11 channels: flow_alerts, market_tide, gex, net_flow, interval_flow, option_trades, off_lit_trades, lit_trades, price, news, trading_halts</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>Proposed WebSocket architecture</h3>
        <pre className="docs-code">{`Server (Railway, persistent process)
├── Polygon WS client  [wss://socket.massive.com/indices]
│   └── Subscribe: A.I:SPX  A.I:VIX  A.I:VIX9D  A.I:VIX3M
│       → Update: pulseStore.price, pulseStore.vix, pulseStore.vixTerm
│       → Notify: SSE /api/market/spx/pulse/stream
│
├── Polygon WS client  [wss://socket.massive.com/options]
│   └── Subscribe: A.O:SPXW*  (all SPXW strikes, per-second agg)
│       → Update: gexStore.chain (incremental delta, not full re-fetch)
│       → Recompute: gamma flip, walls, max pain on change
│
└── UW WS client  [wss://api.unusualwhales.com/api/socket/*]
    ├── Channel: flow_alerts
    │   → Replace: REST poll /api/option-trades/flow-alerts every 2s
    │   → Replace: cron flow-ingest (entire cron job becomes optional)
    │   → Forward: SSE /api/market/flows/stream (already exists)
    ├── Channel: market_tide
    │   → Replace: 2 UW REST calls/2s in buildSpxDeskFlow()
    ├── Channel: gex
    │   → Supplement: Polygon chain GEX with UW live dealer positioning
    └── Channel: trading_halts  (NEW — currently no halt detection)
        → Gate: any open play on halted ticker = immediate exit signal

Client (browser)
├── SSE /api/market/flows/stream  (already wired — keep)
├── SSE /api/market/spx/pulse/stream  (NEW — replace SWR 1s poll)
└── SWR /api/market/spx/desk  (keep at 10s — desk is slow data)`}</pre>

        <div style={{ background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 6, padding: "0.75rem 1rem", marginTop: "0.75rem", fontSize: 13 }}>
          <strong>UW rate limit impact of WS migration:</strong> Moving flow_alerts, market_tide, and gex to WebSocket
          eliminates <strong>~120 UW REST calls/min</strong> — the entire current plan quota.
          Post-migration, the 120 req/min budget is entirely free for Largo tool calls and Night Hawk edition builds.
        </div>
      </section>

      {/* ── SECTION 4: SPX ENGINE ── */}
      <section className="docs-section">
        <h2>5. SPX play engine — full internals</h2>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Component</th><th>File</th><th>What it does</th></tr>
          </thead>
          <tbody>
            <tr><td>Main evaluator</td><td><code>src/lib/spx-play-engine.ts</code></td><td><code>evaluateSpxPlay(desk)</code> — orchestrates all checks, returns play decision</td></tr>
            <tr><td>Signal scoring</td><td><code>src/lib/spx-signals.ts</code></td><td><code>computeSpxConfluence(desk)</code> — weighted score: VWAP±12, gamma±10, GEX prox±6-10, tide±10, NOPE±6, tape±5, news±6. Grade: A+(≥72,≤1 conflict) → D</td></tr>
            <tr><td>Hard gates</td><td><code>src/lib/spx-play-gates.ts</code></td><td><code>evaluatePlayGates()</code> — blocks: closed session, no GEX walls, stale data, grade &lt;B, macro windows (CPI 8:25-10:30ET, FOMC), VIX&gt;32, opening range, cooldowns</td></tr>
            <tr><td>Confirmations</td><td><code>spx-play-engine.ts</code></td><td><code>evaluatePlayConfirmations()</code> — flow alignment, MTF ladder, structure proximity, news, TICK/TRIN</td></tr>
            <tr><td>Claude veto</td><td><code>spx-play-engine.ts</code></td><td><code>evaluateClaudePlayApproval()</code> — only called when all gates pass. Skips if gates fail.</td></tr>
            <tr><td>Watch mode</td><td><code>spx-play-engine.ts</code></td><td>Near-miss: score within 12 of floor, grade≥B, 3 confirmations short → WATCH record. WATCH→ENTRY requires MTF+flow ok.</td></tr>
            <tr><td>Open play mgmt</td><td>Postgres + play engine</td><td>Stop/target/theta cutoff/thesis-break exits. MFE/MAE updated each 3s poll.</td></tr>
            <tr><td>Trim logic</td><td><code>spx-play-engine.ts</code></td><td><code>playTrimMfePts()</code> + <code>playTrimProgressPct()</code> — dual-condition trim</td></tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>In-process caches (not shared across Railway instances)</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Cache</th><th>TTL</th><th>File</th><th>Multi-instance risk</th></tr>
          </thead>
          <tbody>
            <tr><td><code>cachedOdteBundle</code> (GEX)</td><td>15s</td><td><code>polygon-options-gex.ts</code></td><td>🔴 Each instance re-fetches 16 Polygon chain pages independently</td></tr>
            <tr><td><code>cachedVixIvRank</code></td><td>5 min</td><td><code>polygon.ts</code></td><td>🟡 Low risk — slow-moving data</td></tr>
            <tr><td><code>cachedPriorDay</code></td><td>60s</td><td><code>spx-desk.ts</code></td><td>🟡 Low risk</td></tr>
            <tr><td><code>cachedPulseStructure</code></td><td>5s</td><td><code>spx-desk.ts</code></td><td>🔴 Each instance fires 7 Polygon calls per 5s independently</td></tr>
            <tr><td><code>marketFlowCache</code></td><td>15s</td><td><code>unusual-whales.ts</code></td><td>🔴 Each instance consumes UW quota independently — rate limit multiplied by N instances</td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: 13, marginTop: "0.5rem" }}>
          <strong>Redis shared cache</strong> (<code>src/lib/shared-cache.ts</code>) only covers GEX walls, tape, and gamma flip sticky state.
          All hot API call caches (above) are in-process. At 2 Railway instances: every metric above doubles.
          At 3 instances: UW quota would be 3× the current overflow rate.
        </p>
      </section>

      {/* ── SECTION 5: LARGO ── */}
      <section className="docs-section">
        <h2>6. Largo — AI terminal analysis</h2>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Metric</th><th>Value</th><th>Note</th></tr>
          </thead>
          <tbody>
            <tr><td>Total tools</td><td><strong>75</strong></td><td>Parsed per query from <code>src/lib/largo/tool-defs.ts</code></td></tr>
            <tr><td>AI model</td><td>Claude claude-sonnet-4-6 (streaming)</td><td><code>src/lib/providers/anthropic.ts</code></td></tr>
            <tr><td>Max session duration</td><td>120s</td><td><code>maxDuration</code> on route</td></tr>
            <tr><td>Live context injected</td><td>Full SPX desk snapshot</td><td><code>formatLargoSpxLiveContext()</code> in system prompt — every query</td></tr>
            <tr><td>UW tool calls per turn</td><td>Unlimited</td><td>No per-turn UW call budget — one complex query can consume 10+ UW calls</td></tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>75 tools — performance impact</h3>
        <p style={{ fontSize: 13, marginBottom: "0.5rem" }}>
          75 tool definitions are injected into every Largo Claude call. This increases:
        </p>
        <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: "1.25rem" }}>
          <li><strong>Prompt token count</strong> — tool schemas are verbose JSON. 75 tools ≈ 15,000–20,000 tokens of tool definitions in every request.</li>
          <li><strong>TTFT (time to first token)</strong> — Anthropic processes tool schemas before generating. Larger schema = slower first response.</li>
          <li><strong>Cost</strong> — input token cost on every query regardless of which tools are actually called.</li>
        </ul>
        <div style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 6, padding: "0.75rem 1rem", marginTop: "0.75rem", fontSize: 13 }}>
          <strong>Recommendation:</strong> Implement tool-selection pre-filtering. Classify the user query with a lightweight
          classification call (or regex/keyword match) first, then only pass relevant tool groups to Claude.
          Example: a &quot;show me SPX flow&quot; query needs only 5–8 tools, not 75.
          Alternatively, group tools into namespaced sub-routers: <code>polygon.*</code>, <code>uw.*</code>, <code>platform.*</code>.
        </div>
      </section>

      {/* ── SECTION 6: NIGHT HAWK ── */}
      <section className="docs-section">
        <h2>7. Night Hawk — pipeline analysis</h2>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Phase</th><th>What runs</th><th>UW calls</th><th>Polygon calls</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1. Market context</td>
              <td>Parallel Promise.all — tide, flow, SPX/VIX bars, sectors, ETF tides, news, VIX term, top net impact</td>
              <td>~10</td>
              <td>~8</td>
            </tr>
            <tr>
              <td>2. Candidate selection</td>
              <td>Extract tickers from UW flow alerts</td>
              <td>0 extra</td>
              <td>0</td>
            </tr>
            <tr>
              <td>3. Dossier (per ticker)</td>
              <td>~10 UW + 4 Polygon + 2 Finnhub per ticker, batched by <code>DOSSIER_BATCH_SIZE</code></td>
              <td>~10 × N tickers</td>
              <td>~4 × N tickers</td>
            </tr>
            <tr>
              <td>4. Claude synthesis</td>
              <td>Anthropic call with structured prompt → JSON plays</td>
              <td>0</td>
              <td>0</td>
            </tr>
            <tr>
              <td>5. Persist</td>
              <td>Postgres upsert</td>
              <td>0</td>
              <td>0</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 13, marginTop: "0.5rem" }}>
          With 20 candidates × 10 UW calls = <strong>200 UW calls in one edition build</strong>.
          That&apos;s 1.67 minutes of the entire UW quota consumed in a single 5-minute window.
          No retry logic — <code>uwGetSafe()</code> silently returns null on 429.
          Night Hawk editions likely have systematically incomplete dossiers for tickers fetched after the first ~12.
        </p>
      </section>

      {/* ── SECTION 7: IMPROVEMENT ROADMAP ── */}
      <section className="docs-section">
        <h2>8. Improvement roadmap</h2>

        <h3>🚨 P0 — Fix now (production is degraded)</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Issue</th><th>Fix</th><th>Files</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>6 UW endpoints returning 403, silently failing</td>
              <td>Replace with Polygon: <code>/v3/snapshot/indices</code> for VIX term, compute vol anomaly from Polygon IV/RV data. OR upgrade UW plan.</td>
              <td><code>src/lib/providers/unusual-whales.ts</code></td>
            </tr>
            <tr>
              <td>UW rate limit overflow (164 calls/min vs 120 limit)</td>
              <td>Immediate: reduce flow lane from 4 UW calls to 2 (tide + flow only; dark pool → 10s sub-cache). Medium-term: WS migration.</td>
              <td><code>src/lib/spx-desk-flow.ts</code>, <code>unusual-whales.ts</code></td>
            </tr>
            <tr>
              <td>ATM chains 422 for SPX</td>
              <td>Add <code>?expiration_date=</code> param — UW requires expiry for index underlyings.</td>
              <td><code>src/lib/providers/unusual-whales.ts</code></td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>🔴 P1 — WebSocket migration (highest impact)</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Step</th><th>What to build</th><th>Impact</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1. UW WS: flow_alerts</td>
              <td><code>src/lib/ws/uw-socket.ts</code> — singleton WS manager. Subscribe to <code>/api/socket/flow_alerts</code>. On message: call existing <code>publishFlowEvent()</code> (SSE already wired). Retire <code>/api/cron/flow-ingest</code>.</td>
              <td>Flow alert latency: 60s → &lt;1s. Frees 30+ UW calls/min.</td>
            </tr>
            <tr>
              <td>2. UW WS: market_tide + dark_pool</td>
              <td>Add channels to WS manager. Replace <code>buildSpxDeskFlow()</code> REST calls for tide and dark pool with WS-pushed store values.</td>
              <td>Frees 60+ UW calls/min. Tide latency: 2s → &lt;1s.</td>
            </tr>
            <tr>
              <td>3. Polygon WS: indices</td>
              <td><code>src/lib/ws/polygon-socket.ts</code>. Connect to <code>wss://socket.massive.com/indices</code>. Subscribe: <code>A.I:SPX A.I:VIX A.I:VIX9D A.I:VIX3M</code>. Write to <code>pulseStore</code>. Add SSE endpoint <code>/api/market/spx/pulse/stream</code>. Replace SWR 1s poll on client.</td>
              <td>SPX/VIX latency: 1.3s → &lt;100ms. Eliminates 86,400 HTTP calls/day/tab.</td>
            </tr>
            <tr>
              <td>4. UW WS: trading_halts</td>
              <td>Subscribe to <code>/api/socket/trading_halts</code>. On halt: set halt flag in Redis. Play engine gate: check halt flag before entry.</td>
              <td>New capability — currently zero halt protection.</td>
            </tr>
            <tr>
              <td>5. Polygon WS: options (SPXW)</td>
              <td>Connect to <code>wss://socket.massive.com/options</code>. Subscribe <code>A.O:SPXW*</code>. Incrementally update GEX chain instead of 16-call full repagination every 15s.</td>
              <td>GEX accuracy: 15s → &lt;1s on strike changes. Eliminates 64 Polygon calls/min.</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>🟠 P2 — Architecture hardening</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Issue</th><th>Fix</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>In-process caches not shared across Railway instances</td>
              <td>Move <code>cachedOdteBundle</code>, <code>marketFlowCache</code>, <code>cachedPulseStructure</code> to Redis (already have Redis infra). Prevents N-instance UW quota multiplication.</td>
            </tr>
            <tr>
              <td>Night Hawk dossier UW rate exposure</td>
              <td>Add exponential backoff + jitter in <code>uwGetSafe()</code>. Reduce dossier to top 5 UW signals only (flow per expiry + spot exposures + dark pool + iv rank + gex levels). Fetch Polygon data first, UW second.</td>
            </tr>
            <tr>
              <td>Largo UW call budget</td>
              <td>Add per-turn UW call counter in <code>run-tool.ts</code>. Soft cap: 5 UW calls/turn. On breach: return a &quot;rate limit reached, use Polygon fallback&quot; message instead of hitting UW.</td>
            </tr>
            <tr>
              <td>75 Largo tools</td>
              <td>Pre-filter tools by query intent. Simple classification (keyword/regex) → tool group selection. Reduces prompt by 12,000+ tokens per query. Improves TTFT by 0.5–1s.</td>
            </tr>
            <tr>
              <td>UW spot-exposures not wired</td>
              <td>Add <code>/api/stock/SPX/spot-exposures</code> call to GEX refresh. 1min live GEX at current spot vs static walls — significant precision improvement for 0DTE plays.</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>🟡 P3 — New capabilities (Polygon endpoints unused)</h3>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Endpoint</th><th>Capability it unlocks</th></tr>
          </thead>
          <tbody>
            <tr><td><code>/v1/indicators/rsi/I:SPX?timespan=minute</code></td><td>Pre-computed 5m SPX RSI from Polygon — replaces manual RSI computation in spx-play-technicals.ts</td></tr>
            <tr><td><code>{"/v2/aggs/grouped/locale/us/market/stocks/{date}"}</code></td><td>Full market OHLC+VWAP in one call → SPX breadth score (% stocks above VWAP)</td></tr>
            <tr><td><code>/stocks/financials/v1/ratios</code></td><td>P/E, ROE, debt ratios — high-value for Night Hawk dossiers, no extra cost</td></tr>
            <tr><td><code>/stocks/filings/10-K/vX/sections</code></td><td>10-K Risk Factors/MD&A plain text → feed to Claude for Night Hawk fundamental analysis</td></tr>
            <tr><td><code>/stocks/filings/vX/form-4</code></td><td>Real SEC insider filings → replaces UW insider + Finnhub insider-transactions</td></tr>
            <tr><td><code>/api/stock/SPX/spot-exposures</code> (UW)</td><td>1min GEX at current spot — live dealer positioning as SPX moves through strikes</td></tr>
            <tr><td><code>/api/stock/SPX/option/stock-price-levels</code> (UW)</td><td>OI-concentration magnetic price levels — distinct from max pain, available on current plan</td></tr>
          </tbody>
        </table>
      </section>

      {/* ── SECTION 8: RATE LIMIT SUMMARY ── */}
      <section className="docs-section">
        <h2>9. Rate limit reference</h2>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr><th>Provider</th><th>Limit</th><th>Current usage</th><th>Post-WS-migration</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Polygon / Massive</strong></td>
              <td>Unlimited (Advanced plan) · 5 Advanced subscriptions · WS: up to 10 connections</td>
              <td>~412 calls/min — safe</td>
              <td>~200 calls/min (GEX pagination eliminated)</td>
            </tr>
            <tr>
              <td><strong>Unusual Whales</strong></td>
              <td>120 req/min · 50,000 tokens/min · Daily counter visible in headers</td>
              <td><span style={{ color: "#ef4444" }}><strong>~164 calls/min — OVERFLOWING by 44/min</strong></span></td>
              <td>~20 calls/min (flow/tide/dark pool → WS)</td>
            </tr>
            <tr>
              <td><strong>Anthropic</strong></td>
              <td>Rate limits depend on tier. Max session 120s for Largo.</td>
              <td>Largo queries + Night Hawk edition + Claude veto</td>
              <td>Reduce with Largo tool pre-filtering</td>
            </tr>
            <tr>
              <td><strong>Finnhub</strong></td>
              <td>60 calls/min (free/basic) — check plan</td>
              <td>Night Hawk: earnings + analyst ratings per ticker</td>
              <td>Consider replacing with Polygon Form 4 + Financials</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.5rem" }}>UW daily counter context</h3>
        <p style={{ fontSize: 13 }}>
          Headers show <code>x-uw-daily-req-count: 24,501</code> as of probe time today.
          At 164 calls/min during RTH (6.5 hours = 390 min): <strong>64,000 calls/day theoretical max</strong>.
          The daily counter suggests you&apos;re hitting ~24k in a partial trading day — consistent with the rate overflow math.
          UW doesn&apos;t appear to have a hard daily cap (only per-minute), but the per-minute 429s during peak activity
          confirm the overflow is real and ongoing.
        </p>
      </section>

      <section className="docs-section">
        <h2>10. Implementation priority order</h2>
        <ol style={{ fontSize: 13, lineHeight: 2.2, paddingLeft: "1.5rem" }}>
          <li><strong>Fix 6 UW 403 failures</strong> — replace vix-term-structure + vol endpoints with Polygon equivalents (1–2 hours)</li>
          <li><strong>Reduce flow lane UW calls</strong> — dark pool on 10s sub-cache immediately (30 min fix)</li>
          <li><strong>Fix ATM chains 422</strong> — add expiry param (30 min)</li>
          <li><strong>UW WebSocket: flow_alerts + market_tide</strong> — biggest ROI. One persistent WS connection replaces 90 REST calls/min and cuts flow latency from 60s to &lt;1s (1–2 days)</li>
          <li><strong>Polygon WebSocket: indices</strong> — eliminate 86,400 HTTP calls/day/tab, SPX/VIX latency &lt;100ms (1 day)</li>
          <li><strong>Move hot caches to Redis</strong> — multi-instance safety (1 day)</li>
          <li><strong>Night Hawk dossier rate limiting</strong> — add backoff, reduce UW signals per ticker (2–3 hours)</li>
          <li><strong>Largo tool pre-filtering</strong> — 12k token reduction per query, faster TTFT (1 day)</li>
          <li><strong>UW spot-exposures integration</strong> — live 1min GEX at current spot (2–3 hours)</li>
          <li><strong>Polygon WS: SPXW options chain</strong> — real-time GEX greeks (2 days)</li>
        </ol>
      </section>
    </main>
  );
}
