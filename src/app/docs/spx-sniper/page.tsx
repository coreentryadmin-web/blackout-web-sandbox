import Link from "next/link";
import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";

export const revalidate = 0;

export default async function SpxSniperPlaybookPage() {
  await requireTier("premium");

  return (
    <div className="docs-page">
      <Nav />
      <main className="docs-page-main">
        <header className="docs-header">
          <p className="docs-kicker">Blackout · SPX Sniper</p>
          <h1 className="docs-title">Play Engine Playbook</h1>
          <p className="docs-lead">
            Full reference for the SPX Sniper desk: the main 0DTE play state machine, the parallel pre-market
            lotto engine, entry gates, exit cooldowns, confirmations, session cutoffs, and how the panel interprets
            every action.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
            <Link href="/dashboard" className="docs-back-link">
              ← Back to desk
            </Link>
            <Link href="/docs/spx-sniper/cursor-spx-slayer-analysis" className="docs-back-link">
              Full system analysis →
            </Link>
            <a
              href="/api/docs/spx-playbook"
              download="SPX-Sniper-Playbook.docx"
              className="docs-download-link"
            >
              Download offline Word doc (.docx)
            </a>
          </div>
        </header>

        <section className="docs-section">
          <h2>Architecture — two parallel tracks</h2>
          <p>
            SPX Sniper runs <strong>two independent state machines</strong>. They share the same desk data feed
            (Polygon + Unusual Whales + Finnhub) but never share play slots or bias each other.
          </p>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Track</th>
                <th>Window</th>
                <th>Purpose</th>
                <th>Slot</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Main 0DTE plays</strong></td>
                <td>9:30 AM – 3:50 PM ET</td>
                <td>Intraday momentum reads — one open play at a time</td>
                <td><code>spx_open_play</code></td>
              </tr>
              <tr>
                <td><strong>Lotto engine</strong></td>
                <td>7:00 AM – 10:30 AM ET</td>
                <td>Pre-market catalyst thesis — far OTM ±25pt lotto</td>
                <td><code>lotto_plays</code> (separate)</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            <strong>Critical rule:</strong> If the lotto is CALL at 8:00 AM and the desk signals PUT at 10:15 AM,
            take the PUT. Lotto is a full-day catalyst read; regular plays are intraday momentum reads. The lotto
            never blocks, promotes, or consumes the main <code>spx_open_play</code> slot.
          </p>
        </section>

        <section className="docs-section">
          <h2>Session timeline (ET, weekdays)</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Main engine</th>
                <th>Lotto engine</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Before 7:00 AM</td>
                <td>Closed</td>
                <td>Off</td>
              </tr>
              <tr>
                <td>7:00 – 9:30 AM</td>
                <td>Desk live · SCANNING / WATCH only · <strong>no BUY</strong></td>
                <td>Scans catalysts · forms LOTTO WATCH if qualified</td>
              </tr>
              <tr>
                <td>9:30 – 9:45 AM</td>
                <td>Cash open · WATCH ok · <strong>no cold BUY</strong> (opening range)</td>
                <td>Watches for open confirm · can transition to BUY LOTTO</td>
              </tr>
              <tr>
                <td>9:45 AM – 3:30 PM</td>
                <td>Full entry path · BUY / HOLD / TRIM / SELL</td>
                <td>Manages open lotto HOLD · expires new entries at 10:30 AM</td>
              </tr>
              <tr>
                <td>3:30 – 3:50 PM</td>
                <td><strong>No new entries</strong> (flat path) · open plays still managed</td>
                <td>Off</td>
              </tr>
              <tr>
                <td>3:50 PM+</td>
                <td><strong>Force-exit</strong> any open 0DTE (THETA)</td>
                <td>Off</td>
              </tr>
            </tbody>
          </table>
          <p>
            <strong>Independent cutoffs:</strong> <code>SPX_PLAY_NO_ENTRY_ET_HOUR=15/MIN=30</code> blocks new
            entries on the flat path only. <code>SPX_PLAY_FORCE_EXIT_ET_HOUR=15/MIN=50</code> force-flattens open
            plays on the HOLD/TRIM path only. These are separate conditions by design.
          </p>
        </section>

        <section className="docs-section">
          <h2>Main play state machine</h2>
          <p>
            The main engine polls every ~3 seconds via <code>/api/market/spx/play</code>. It merges desk + flow +
            pulse, scores confluence, runs confirmations and gates, then outputs one action for the center panel.
            Only <strong>one open play</strong> at a time.
          </p>
          <pre className="docs-diagram">{`SCANNING ──► WATCHING ──► BUY (CALL/PUT)
    ▲              │              │
    │              │              ▼
    └──── SELL ◄── TRIM ◄── HOLD (open play)`}</pre>
          <ul className="docs-list">
            <li>
              <strong>SCANNING</strong> — No entry. Gates or confirmations have not cleared. Panel shows play-idea
              intel or rotating desk copy.
            </li>
            <li>
              <strong>WATCHING</strong> — Setup forming. MTF ladder and structure are close. Engine records a watch
              for WATCH→ENTRY promote.
            </li>
            <li>
              <strong>BUY CALL / BUY PUT</strong> — Entry fired. Open 0DTE play stored with stop, target, and
              option ticket (Polygon SPXW chain when liquid).
            </li>
            <li>
              <strong>HOLD</strong> — Open play working. Thesis and structure still support direction. MFE/MAE
              tracked every poll.
            </li>
            <li>
              <strong>TRIM</strong> — Partial take-profit zone. MFE into target; engine suggests banking ~50% and
              trailing runner.
            </li>
            <li>
              <strong>SELL</strong> — Flatten: stop, target, thesis break, or session close. Returns to SCANNING.
            </li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>Confluence score &amp; grade</h2>
          <p>
            Weighted score from desk inputs: VWAP position, gamma regime, GEX walls, 0DTE flow, VIX term structure,
            market tide, dark pool, EMAs/SMAs, TICK breadth proxy, news sentiment, macro events, and more. Positive
            score leans calls; negative leans puts.
          </p>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>Typical conditions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>A+</td>
                <td>|score| ≥ 72, ≤1 opposing factor</td>
              </tr>
              <tr>
                <td>A</td>
                <td>|score| ≥ 58, ≤2 opposing factors</td>
              </tr>
              <tr>
                <td>B</td>
                <td>|score| ≥ 45, ≤3 opposing factors</td>
              </tr>
              <tr>
                <td>C / D</td>
                <td>Weaker alignment — usually SCAN / WATCH only</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            Entry min grade is <strong>B</strong> (|score| ≥ 45, ≤3 opposing factors). There is no separate B+ tier —
            weighted conflicts (&lt; 4) filter weak B setups instead of inventing a midpoint grade.
          </p>
        </section>

        <section className="docs-section">
          <h2>Weighted conflicts</h2>
          <p>
            Raw conflict count = factors pointing against your direction. <strong>Weighted conflicts</strong> apply
            2× weight to hard opposes before blocking entry:
          </p>
          <ul className="docs-list">
            <li>
              <strong>Market tide</strong> — UW tide bullish/bearish opposes your direction (counts 2× if also
              surfaced as a confluence factor)
            </li>
            <li>
              <strong>News sentiment</strong> — Benzinga headline tone opposes your direction (counts 2×)
            </li>
            <li>
              <strong>GEX / gamma regime</strong> — Dealer map or gamma flip opposes your lane (counts 2×)
            </li>
            <li>
              <strong>VIX extreme</strong> — VIX &gt; 28 opposes new longs; VIX &lt; 14 opposes new shorts (counts
              2×)
            </li>
            <li>
              <strong>IV rank</strong> — UW IV rank &gt; 70 opposes longs (fade risk); IV rank &lt; 30 opposes shorts
              (squeeze risk). When this factor appears against your direction in confluence, it counts 2× like the
              rows above.
            </li>
          </ul>
          <p>
            Any other opposing confluence factor counts 1×. γ/GEX-labeled factors in the factor list also count 2×
            when they oppose direction. Entry blocks when <strong>weighted conflicts ≥ 4</strong> (default).
          </p>
        </section>

        <section className="docs-section">
          <h2>Entry gates (flat path — SCANNING → BUY)</h2>
          <p>
            These gates apply to the <strong>flat path only</strong> (no open play). Open-play management uses
            separate exit logic. All must pass for a cold BUY:
          </p>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Default</th>
                <th>What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Min grade</td>
                <td>B or better</td>
                <td>Confluence quality floor</td>
              </tr>
              <tr>
                <td>Full entry score</td>
                <td>|score| ≥ 58</td>
                <td>Strong directional read (full size)</td>
              </tr>
              <tr>
                <td>Starter entry</td>
                <td>|score| ≥ 48</td>
                <td>Smaller B-grade entries when enabled</td>
              </tr>
              <tr>
                <td>Watch band</td>
                <td>|score| ≥ 38</td>
                <td>Minimum to stay on WATCH</td>
              </tr>
              <tr>
                <td>Promote score</td>
                <td>|score| ≥ 48</td>
                <td>WATCH→ENTRY — 0DTE flow required</td>
              </tr>
              <tr>
                <td>Opening range</td>
                <td>Until 9:45 AM ET</td>
                <td>No cold BUY first 15m after 9:30 — WATCH still allowed</td>
              </tr>
              <tr>
                <td>Pre-market</td>
                <td>Before 9:30 AM</td>
                <td>No BUY — desk loads data, WATCH ok</td>
              </tr>
              <tr>
                <td>Post-STOP cooldown</td>
                <td>20 min</td>
                <td>
                  <strong>STOP exits only</strong> — blocks new BUY in any direction. WATCH still allowed. THESIS /
                  TARGET / win exits do <em>not</em> trigger this gate.
                </td>
              </tr>
              <tr>
                <td>Buy cooldown</td>
                <td>10 min</td>
                <td>
                  <strong>Any exit</strong> (win or loss) — general spacing before the next BUY.{" "}
                  <strong>A+ setups bypass</strong> the block and surface a warning instead.
                </td>
              </tr>
              <tr>
                <td>Re-entry lock</td>
                <td>20 min</td>
                <td>
                  <strong>Any loss exit</strong> (STOP + THESIS) — same direction blocked. Opposite direction is ok
                  unless post-STOP cooldown is also active.
                </td>
              </tr>
              <tr>
                <td>Weighted conflicts</td>
                <td>&lt; 4</td>
                <td>Hard opposes count 2× (see above)</td>
              </tr>
              <tr>
                <td>Confirmations</td>
                <td>6+ of 11</td>
                <td>MTF, structure, flow, etc.</td>
              </tr>
              <tr>
                <td>Agreeing factors</td>
                <td>4+</td>
                <td>Factors aligned with direction</td>
              </tr>
              <tr>
                <td>GEX walls</td>
                <td>Required</td>
                <td>No entry without dealer map</td>
              </tr>
              <tr>
                <td>Desk freshness</td>
                <td>&lt; 120s</td>
                <td>Stale GEX/desk data blocks entry</td>
              </tr>
              <tr>
                <td>Macro hard block</td>
                <td>8:25–10:30 AM</td>
                <td>CPI / FOMC / Fed event window</td>
              </tr>
              <tr>
                <td>VIX ceiling</td>
                <td>&gt; 32</td>
                <td>Too hot for new 0DTE entries</td>
              </tr>
              <tr>
                <td>No-entry cutoff</td>
                <td>3:30 PM ET</td>
                <td>Flat path only — no new BUY or promote</td>
              </tr>
              <tr>
                <td>Claude gate</td>
                <td>On if API key</td>
                <td>Final arbiter on A/A+ setups with passed confirmations</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            <strong>Cooldown overlap:</strong> After a STOP loss, post-STOP cooldown (any direction) and re-entry lock
            (same direction) can both fire — they are independent. After a THESIS loss, only re-entry lock + buy
            cooldown apply. After a winning TARGET exit, only buy cooldown applies (A+ can bypass).
          </p>
          <p className="docs-note">
            See <em>Adaptive telemetry</em> below for outcome-driven score floors and promote-path tuning.
          </p>
        </section>

        <section className="docs-section">
          <h2>Exit cooldowns &amp; session memory</h2>
          <p>
            After any closed play, the engine stores timing metadata in{" "}
            <code>platform_meta</code> key <code>spx_play_session_meta</code>. Three <strong>independent</strong>{" "}
            cooldown gates read that state on the flat path (SCANNING → BUY). They stack — multiple blocks can appear
            at once — but each gate has a distinct trigger and scope.
          </p>

          <h3 className="docs-subheading">Session meta payload</h3>
          <p>Written on every BUY and SELL. Persisted as JSON in Postgres (or in-memory when DB is offline):</p>
          <pre className="docs-code">{`{
  "last_buy_at": 1718635200000,       // epoch ms — set on every BUY
  "last_sell_at": 1718636400000,      // epoch ms — set on every exit (win or loss)
  "last_sell_was_loss": true,         // true for STOP + THESIS; false for TARGET + THETA
  "last_direction": "long",           // direction of the play that just closed
  "last_stop_at": 1718636400000       // epoch ms — set ONLY when exit_action === "STOP"
}`}</pre>
          <p>
            <code>last_stop_at</code> is the critical discriminator: THESIS losses update{" "}
            <code>last_sell_was_loss</code> but do <em>not</em> touch <code>last_stop_at</code>. That is why
            post-STOP cooldown and re-entry lock are not redundant — they cover different exit types and scopes.
          </p>

          <h3 className="docs-subheading">Three cooldown gates</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Env var</th>
                <th>Default</th>
                <th>Triggered by</th>
                <th>Scope</th>
                <th>WATCH ok?</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Buy cooldown</strong></td>
                <td><code>SPX_PLAY_BUY_COOLDOWN_SEC</code></td>
                <td>600s (10 min)</td>
                <td>Any exit — TARGET win, THETA flat, STOP, THESIS, SESSION</td>
                <td>Blocks new BUY (any direction)</td>
                <td>Yes — WATCH / SCAN still allowed</td>
              </tr>
              <tr>
                <td><strong>Post-STOP cooldown</strong></td>
                <td><code>SPX_PLAY_COOLDOWN_AFTER_STOP_MIN</code></td>
                <td>20 min</td>
                <td><strong>STOP exits only</strong> (<code>exit_action === "STOP"</code>)</td>
                <td>Blocks new BUY in <em>any</em> direction</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td><strong>Re-entry lock</strong></td>
                <td><code>SPX_PLAY_REENTRY_LOCK_SEC</code></td>
                <td>1200s (20 min)</td>
                <td>Any <strong>loss</strong> exit — STOP + THESIS (<code>was_loss === true</code>)</td>
                <td>Blocks new BUY in the <em>same</em> direction only</td>
                <td>Yes</td>
              </tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Exit type → which gates fire</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Exit</th>
                <th>Loss?</th>
                <th>Sets last_stop_at?</th>
                <th>Buy cooldown</th>
                <th>Post-STOP</th>
                <th>Re-entry lock</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>STOP</td>
                <td>Yes</td>
                <td>Yes</td>
                <td>✓</td>
                <td>✓ (any dir)</td>
                <td>✓ (same dir)</td>
              </tr>
              <tr>
                <td>THESIS</td>
                <td>Yes</td>
                <td>No</td>
                <td>✓</td>
                <td>—</td>
                <td>✓ (same dir)</td>
              </tr>
              <tr>
                <td>TARGET</td>
                <td>No</td>
                <td>No</td>
                <td>✓</td>
                <td>—</td>
                <td>—</td>
              </tr>
              <tr>
                <td>THETA (3:50 PM)</td>
                <td>No</td>
                <td>No</td>
                <td>✓</td>
                <td>—</td>
                <td>—</td>
              </tr>
              <tr>
                <td>SESSION</td>
                <td>No*</td>
                <td>No</td>
                <td>✓</td>
                <td>—</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
          <p className="docs-note">
            *SESSION flatten when the desk closes is not scored as a loss unless price already hit stop or thesis
            break on that same tick.
          </p>

          <h3 className="docs-subheading">Worked examples</h3>
          <ul className="docs-list">
            <li>
              <strong>STOP long at 10:00 AM</strong> — Until 10:10 AM buy cooldown blocks all BUYs. Until 10:20 AM
              post-STOP blocks all BUYs. Until 10:20 AM re-entry lock blocks another long. A short setup at 10:05 AM
              is blocked by post-STOP but <em>not</em> by re-entry lock.
            </li>
            <li>
              <strong>THESIS loss short at 11:00 AM</strong> — Buy cooldown until 11:10 AM. Re-entry lock on shorts
              until 11:20 AM. No post-STOP (price did not hit stop). A long CALL at 11:05 AM is allowed if other
              gates pass.
            </li>
            <li>
              <strong>TARGET win long at 2:00 PM</strong> — Only buy cooldown until 2:10 PM. No post-STOP, no
              re-entry lock. Opposite-direction re-entry is fine immediately after cooldown (or sooner with A+
              bypass).
            </li>
          </ul>

          <h3 className="docs-subheading">A+ buy-cooldown bypass</h3>
          <p>
            When an A+ setup appears inside the 10-minute buy-cooldown window, the engine does <strong>not</strong>{" "}
            block entry. Instead it surfaces a <strong>warning</strong> in the confirmations panel:
          </p>
          <pre className="docs-code">{`⚠ A+ setup — buy cooldown bypassed (4m since last exit, 10m default)`}</pre>
          <p>
            Controlled by <code>SPX_PLAY_BUY_COOLDOWN_APLUS_BYPASS=1</code> (default on). Set to{" "}
            <code>0</code> to enforce buy cooldown even on A+ grades. <strong>Important:</strong> A+ bypass applies
            only to buy cooldown — post-STOP and re-entry lock still block normally. Grade A (not A+) does not
            bypass.
          </p>
          <p>
            WATCH→ENTRY promote path strips buy-cooldown blocks from its promote evaluation (along with grade-floor
            and re-entry-lock blocks) so a matured watch can still promote when telemetry allows — but post-STOP
            cooldown is never stripped.
          </p>
        </section>

        <section className="docs-section">
          <h2>11-point confirmation checklist</h2>
          <p>Required checks must pass; optional checks add confidence. Default: 6+ of 11 total must pass.</p>
          <ul className="docs-list">
            <li><strong>3m MTF (required)</strong> — 3-minute close holds key level. B/A grades can soft-pass with strong 5m.</li>
            <li><strong>5m trend (required)</strong> — T1 trigger → T2 3m → T3 5m ladder.</li>
            <li><strong>S/R structure (required)</strong> — GEX wall, VWAP, or session level in your favor.</li>
            <li><strong>Breakout / level (required)</strong> — PDH/PDL, HOD/LOD, or VWAP reclaim/reject.</li>
            <li><strong>0DTE flow (required)</strong> — SPX 0DTE premium skew aligns with direction.</li>
            <li><strong>Dark pool (optional)</strong> — No institutional bias against your side.</li>
            <li><strong>Market tide (optional)</strong> — UW tide neutral or aligned.</li>
            <li><strong>Internals (optional)</strong> — TICK breadth proxy not fighting direction.</li>
            <li><strong>News catalyst (optional)</strong> — Headline sentiment not opposing the trade.</li>
            <li><strong>Dealer GEX (optional)</strong> — Gamma regime + flip context supports the lane.</li>
            <li><strong>Vol regime (optional)</strong> — VIX not extreme for new 0DTE risk.</li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>WATCH → ENTRY promote</h2>
          <p>After a watch record exists with MTF confirmed, a later tick can promote to BUY when:</p>
          <ul className="docs-list">
            <li>|score| ≥ 48 (promote floor; adaptive telemetry may raise this)</li>
            <li>0DTE flow aligned with direction</li>
            <li>Price has not drifted away from watch level</li>
            <li>Watch age &lt; 30 minutes (extends to 45 min if flow + TICK still aligned)</li>
            <li>All entry gates pass with <code>entry_intent: buy</code></li>
            <li>Claude approves (if gate enabled)</li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>Adaptive telemetry (outcome-driven floors)</h2>
          <p>
            After enough closed main plays are logged to <code>spx_play_outcomes</code>, the engine reads rolling
            stats and may tighten entry floors. Telemetry is cached for 5 minutes. It only activates once both
            thresholds are met:
          </p>
          <ul className="docs-list">
            <li>
              <code>SPX_OUTCOME_MIN_TRADES=8</code> — at least 8 closed plays in the lookback window
            </li>
            <li>
              <code>SPX_OUTCOME_MIN_DAYS=14</code> — at least 14 calendar days of outcome data
            </li>
          </ul>
          <p>Before those minimums, telemetry is in &quot;collecting data&quot; mode and applies no boosts.</p>

          <h3 className="docs-subheading">What changes when telemetry is active</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Condition</th>
                <th>Env var(s)</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Overall win rate &lt; 45%</td>
                <td><code>SPX_ADAPTIVE_MIN_WIN_RATE=0.45</code></td>
                <td>
                  <strong>+3 points</strong> to full-entry and promote score floors (
                  <code>global_min_score_boost</code>). Default full min 58 → 61; promote min 48 → 51 before
                  promote-specific boosts.
                </td>
              </tr>
              <tr>
                <td>
                  WATCH→ENTRY win rate trails cold BUY by ≥15 percentage points (each path needs ≥3 closed trades)
                </td>
                <td>
                  <code>SPX_PROMOTE_UNDERPERFORM_GAP=0.15</code>
                  <br />
                  <code>SPX_PROMOTE_SCORE_BOOST=5</code>
                </td>
                <td>
                  <strong>+5 points</strong> on top of any global boost, applied only to the{" "}
                  <strong>promote score floor</strong> (<code>promote_min_score_boost</code>). Example: if global
                  +3 is also active, promote min becomes 48 + 3 + 5 = <strong>56</strong>.
                </td>
              </tr>
              <tr>
                <td>
                  Promote underperforms cold BUY by ≥30 pts (2× gap) <em>and</em> promote win rate &lt; 35%
                </td>
                <td>(derived from gap × 2)</td>
                <td>
                  <strong>WATCH→ENTRY path blocked entirely</strong> until stats improve (
                  <code>promote_blocked</code>). Cold BUY can still fire if other gates pass.
                </td>
              </tr>
              <tr>
                <td>Early promote sample: ≥2 promote trades, 0% win rate</td>
                <td>—</td>
                <td>
                  Promote floor gets at least <strong>+5</strong> (same as{" "}
                  <code>SPX_PROMOTE_SCORE_BOOST</code>) even before the 3-trade sample is reached.
                </td>
              </tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Which floors move</h3>
          <ul className="docs-list">
            <li>
              <strong>Full entry</strong> — <code>effectiveFullMinScore = SPX_PLAY_FULL_MIN_SCORE + global boost</code>{" "}
              (default 58, up to 61). Used for cold BUY full-size entries and near-miss WATCH band logic.
            </li>
            <li>
              <strong>Promote entry</strong> —{" "}
              <code>effectivePromoteMinScore = SPX_PLAY_PROMOTE_MIN_SCORE + global boost + promote boost</code>{" "}
              (default 48, up to 56 with both boosts). Used only on the WATCH→ENTRY path.
            </li>
            <li>
              <strong>Starter entry</strong> (<code>SPX_PLAY_STARTER_MIN_SCORE=48</code>) —{" "}
              <em>not</em> raised by telemetry today. Starter sizing still uses the base env threshold.
            </li>
            <li>
              <strong>Watch band</strong> (<code>SPX_PLAY_WATCH_MIN_SCORE=38</code>) — unchanged by telemetry.
            </li>
          </ul>
          <p>
            The panel surfaces active telemetry in the confirmations block (violet line) and as gate warnings like{" "}
            <code>Adaptive score floor +3</code> or <code>Telemetry promote floor +5</code>.
          </p>
        </section>

        <section className="docs-section">
          <h2>BUY — opening a play</h2>
          <ol className="docs-ordered">
            <li>Direction locks to <strong>long</strong> (CALL) or <strong>short</strong> (PUT).</li>
            <li>
              <strong>Entry</strong> = current SPX print. <strong>Stop</strong> = GEX support/resistance or
              LOD/HOD/VWAP. <strong>Target</strong> = opposite wall or session extreme.
            </li>
            <li>
              Polygon SPXW chain builds an <strong>option ticket</strong> (strike, premium range, delta, spread).
              Spread filter: <strong>20%</strong> max in the first 30 minutes after 9:30 AM ET, then{" "}
              <strong>18%</strong> for the rest of the session.
            </li>
            <li>
              Play persisted in <code>spx_open_play</code>. Entry snapshot logged to{" "}
              <code>spx_play_outcomes</code> for admin analytics.
            </li>
          </ol>
        </section>

        <section className="docs-section">
          <h2>HOLD — managing an open play</h2>
          <ul className="docs-list">
            <li>Action stays <strong>HOLD</strong> while price is between stop and target.</li>
            <li>MFE / MAE tracked every poll for trim logic and post-trade analytics.</li>
            <li>Confirmations panel stays visible with live checklist updates.</li>
            <li><code>entry_score</code> stored at open — used for dynamic thesis-break calculation.</li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>TRIM — partial profit</h2>
          <p>Triggers when all of:</p>
          <ul className="docs-list">
            <li>MFE ≥ <strong>12 pts</strong> (<code>SPX_PLAY_TRIM_MFE_PTS</code>)</li>
            <li>Progress ≥ <strong>70%</strong> of entry→target distance (<code>SPX_PLAY_TRIM_PROGRESS_PCT=0.70</code>)</li>
            <li>Trim not already done on this play</li>
          </ul>
          <p>
            Message: <em>&quot;TRIM — bank partial, trail runner.&quot;</em> Reduce size manually; engine marks
            <code>trim_done</code> and continues managing the runner as HOLD until SELL.
          </p>
        </section>

        <section className="docs-section">
          <h2>SELL — closing the play</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Exit</th>
                <th>Condition</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>STOP</td>
                <td>Price through stop level (structure broken)</td>
                <td>Open play</td>
              </tr>
              <tr>
                <td>TARGET</td>
                <td>Price reaches target zone</td>
                <td>Open play</td>
              </tr>
              <tr>
                <td>THESIS</td>
                <td>Score drop ≥12 from entry_score <strong>OR</strong> crosses ±40 absolute floor</td>
                <td>Open play</td>
              </tr>
              <tr>
                <td>THETA</td>
                <td>3:50 PM ET — force-flatten open 0DTE</td>
                <td>Open play only</td>
              </tr>
              <tr>
                <td>SESSION</td>
                <td>Desk session closed</td>
                <td>Open play</td>
              </tr>
            </tbody>
          </table>
          <p>
            <strong>Thesis break (OR logic):</strong> for a <em>long</em>, flatten when{" "}
            <code>score ≤ max(−40, entry_score − 12)</code>. For a <em>short</em>, flatten when{" "}
            <code>score ≥ min(+40, entry_score + 12)</code>. Whichever threshold binds first wins — e.g. entry
            at <strong>+44</strong> exits at <strong>32</strong> (drop binds); entry at <strong>+72</strong> exits
            at <strong>60</strong>.
          </p>
          <p>
            <strong>Session meta on close:</strong> every exit sets <code>last_sell_at</code>. Loss exits
            (STOP, THESIS) set <code>last_sell_was_loss: true</code>. Only STOP sets{" "}
            <code>last_stop_at</code>. See <em>Exit cooldowns &amp; session memory</em> for the full gate matrix.
          </p>
        </section>

        <section className="docs-section">
          <h2>Lotto engine — parallel pre-market track</h2>
          <p>
            A <strong>directional bias engine</strong> that runs 7:00–10:30 AM ET. It synthesizes pre-market
            intelligence and outputs one high-conviction far-OTM 0DTE strike targeting ±25+ SPX points. Think of it
            as the desk&apos;s morning thesis — not a generic scan. Default: <strong>&quot;No lottos today&quot;</strong>.
          </p>
          <pre className="docs-diagram">{`PRE-MARKET (7:00–9:30 ET)
─────────────────────────
LOTTO_SCAN → LOTTO_WATCH (thesis forming)
                 │
          9:30 ET open
                 │
        ┌────────┴────────┐
   LOTTO_BUY          LOTTO_INVALID
   (momentum confirmed)   (thesis broken)
        │                     │
   LOTTO_HOLD         (try 1 reversal scan)
        │                     │
   LOTTO_SELL          No lottos today`}</pre>
          <p>
            Polls via <code>/api/market/lotto/today</code> — <strong>60s</strong> during 7:00–9:30 AM ET,{" "}
            <strong>10s</strong> during 9:30–10:30 AM ET. State stored in <code>platform_meta</code> (live) and
            logged to <code>lotto_plays</code> (history). Max <strong>2 picks per day</strong> (1 primary + 1
            reversal attempt).
          </p>
        </section>

        <section className="docs-section">
          <h2>Lotto — pre-market data sources</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Source</th>
                <th>What it checks</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Overnight flow</td>
                <td>UW / Polygon</td>
                <td>Large SPX/SPY prints, skew direction</td>
              </tr>
              <tr>
                <td>Dark pool</td>
                <td>UW dark prints</td>
                <td>Accumulation side vs prior close (2× threshold)</td>
              </tr>
              <tr>
                <td>News / catalyst</td>
                <td>Benzinga (Polygon) + static calendar</td>
                <td>CPI, FOMC, NFP dates curated in-app; headline keyword fallback</td>
              </tr>
              <tr>
                <td>Overnight gap</td>
                <td>Polygon SPY snapshot (pre-market) / SPX (RTH)</td>
                <td>
                  No ES futures feed — SPY <code>todaysChangePerc</code> proxies overnight move before
                  9:30; after open uses SPX vs prior close (<code>gap_source</code> on desk)
                </td>
              </tr>
              <tr>
                <td>VIX term structure</td>
                <td>UW</td>
                <td>VIX9D vs VIX — backwardation = fear bid / vol expansion</td>
              </tr>
              <tr>
                <td>Overnight GEX</td>
                <td>Polygon SPXW chain</td>
                <td>Where gamma walls sit before open</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>Lotto — catalyst tier (need ≥1 to qualify)</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Catalyst</th>
                <th>Threshold</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Macro event today</td>
                <td>CPI, FOMC, PCE, NFP, jobs, GDP, etc.</td>
                <td>Strongest signal — static US macro schedule (Finnhub calendar if premium)</td>
              </tr>
              <tr>
                <td>Overnight flow skew</td>
                <td>&gt; $5M notional one direction</td>
                <td><code>SPX_PLAY_LOTTO_FLOW_MIN=5000000</code></td>
              </tr>
              <tr>
                <td>Gap</td>
                <td>&gt; 0.4% from prior close</td>
                <td><code>SPX_PLAY_LOTTO_GAP_MIN_PCT=0.4</code></td>
              </tr>
              <tr>
                <td>Dark pool accumulation</td>
                <td>&gt; 2× average on one side</td>
                <td>Call or put premium dominance</td>
              </tr>
              <tr>
                <td>VIX backwardation</td>
                <td>VIX9D &gt; VIX</td>
                <td>Fear bid — suggests vol expansion day</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>Lotto — direction confirmation (need ≥3 agreeing)</h2>
          <p>All direction signals must agree on the same side. Engine counts votes from:</p>
          <ul className="docs-list">
            <li><strong>Overnight flow direction</strong> — 0DTE net or call/put-led tape</li>
            <li><strong>Futures gap direction</strong> — positive gap = long, negative = short</li>
            <li><strong>Dark pool side</strong> — institutional accumulation bias</li>
            <li><strong>Technical alignment</strong> — above/below prior close, VWAP, PDH/PDL, key GEX wall</li>
          </ul>
          <p>
            <strong>Qualifies → LOTTO WATCH</strong> when ≥1 catalyst AND ≥3 direction signals agree (default{" "}
            <code>SPX_PLAY_LOTTO_MIN_DIRECTION_SIGNALS=3</code>). Conflicting signals or no catalyst →{" "}
            <strong>No lottos today</strong>.
          </p>
        </section>

        <section className="docs-section">
          <h2>Lotto — open anchor &amp; the 8-point rule</h2>
          <p>
            All pre-BUY confirm/invalidation math uses the same reference price — the <strong>open anchor</strong>:
          </p>
          <ul className="docs-list">
            <li>
              <strong>Open anchor</strong> = first SPX print captured at or immediately after 9:30 AM ET cash open
              (first post-open desk poll, effectively the ~9:30:01 ET print). Not prior close, not pre-market high —
              even on a 10pt gap, you still need +8pt <em>from the opening print</em> to confirm.
            </li>
            <li>
              <strong>Confirm move (pre-BUY)</strong> — SPX moves ≥ 8 pts in lotto direction from open anchor →
              eligible for BUY LOTTO (plus 5m candle + flow).
            </li>
            <li>
              <strong>Invalidation (pre-BUY)</strong> — While still in LOTTO WATCH, SPX moves ≥ 8 pts{" "}
              <em>opposite</em> direction from open anchor → <strong>INVALIDATED</strong> (do not enter; scan reversal
              once).
            </li>
            <li>
              <strong>Stop (post-BUY)</strong> — After BUY LOTTO fills, measure from <strong>entry price</strong> (SPX
              at fill), not open anchor. SPX moves −8 pts against entry → <strong>LOTTO STOPPED</strong> (forced exit).
            </li>
          </ul>
          <p>
            Same 8-point threshold, two different anchors: open anchor gates whether you enter; entry price gates
            whether you stay in after filling.
          </p>
        </section>

        <section className="docs-section">
          <h2>Lotto — post-open entry &amp; invalidation</h2>
          <p>After 9:30 AM ET, while in <strong>LOTTO WATCH</strong> (not yet filled):</p>
          <p><strong>BUY LOTTO when all of:</strong></p>
          <ul className="docs-list">
            <li>
              Price moves ≥ <strong>8 pts</strong> in lotto direction from <strong>open anchor</strong> (default{" "}
              <code>SPX_PLAY_LOTTO_CONFIRM_MOVE_PTS=8</code>)
            </li>
            <li>First completed 5m candle closes in lotto direction (or PDH/PDL break aligned)</li>
            <li>0DTE flow at open skews same direction as pre-market thesis</li>
          </ul>
          <p><strong>INVALIDATED (pre-BUY — do not enter) when any of:</strong></p>
          <ul className="docs-list">
            <li>
              SPX moves ≥ 8 pts <em>opposite</em> lotto direction from <strong>open anchor</strong> (thesis wrong
              before fill)
            </li>
            <li>First 5m candle closes hard against thesis (trend + level break)</li>
            <li>Opening range breaks the wrong way (invalidation level breached)</li>
          </ul>
          <p>
            On invalidation: engine runs one <strong>reversal scan</strong> (see below). If nothing qualifies →
            &quot;No lottos today.&quot; Lotto expires if not triggered by <strong>10:30 AM ET</strong> — after
            that, premium on a 25+ pt OTM strike is essentially gone or the move already happened.
          </p>
          <p><strong>LOTTO HOLD exit (post-BUY — already filled):</strong></p>
          <ul className="docs-list">
            <li>
              <strong>LOTTO WIN</strong> — SPX moves +25 pts (target) from <strong>entry price</strong> in lotto
              direction
            </li>
            <li>
              <strong>LOTTO STOPPED</strong> — SPX moves −8 pts from <strong>entry price</strong> against the lotto
              (forced exit; not measured from open anchor)
            </li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>Lotto — reversal scan (one second chance)</h2>
          <p>
            When a pre-BUY lotto is <strong>INVALIDATED</strong> — e.g. you were watching a CALL and SPX drops 8+
            points from the open anchor at cash open — the dead thesis is cleared and the engine gets{" "}
            <strong>one reversal attempt</strong> (<code>pick_count</code> increments; max{" "}
            <code>SPX_PLAY_LOTTO_MAX_PICKS=2</code> per day).
          </p>
          <p>
            <strong>Scoring:</strong> The reversal scan is <em>not</em> a mechanical direction flip. It re-runs the
            full <code>evaluateLottoCatalysts()</code> pipeline on the <strong>current live desk</strong> — same bar
            as the first watch: ≥1 catalyst-tier signal <strong>and</strong> ≥3 agreeing direction votes (
            <code>SPX_PLAY_LOTTO_MIN_DIRECTION_SIGNALS=3</code>). If the open drop now makes gap, flow, dark pool,
            and technical signals vote PUT, you get a new PUT lotto watch. The invalidation move alone is{" "}
            <strong>not</strong> sufficient evidence — live catalyst + direction must still qualify.
          </p>
          <p>
            <strong>Open anchor on reversal:</strong> The original 9:30 print is discarded with the failed watch. The
            new reversal watch starts with <code>open_anchor_price: null</code> and locks its anchor on the{" "}
            <strong>next poll</strong> to whatever SPX is printing at that moment (typically the price right after
            invalidation, not the first 9:30 print). All ±8pt confirm/invalidation math for the reversal uses this
            fresh anchor. Record is tagged <code>is_reversal: true</code> in <code>lotto_plays</code>.
          </p>
          <p>
            If the reversal scan does not qualify → <strong>No lottos today</strong>. If pick #2 was already used →
            no further scans regardless of tape.
          </p>
        </section>

        <section className="docs-section">
          <h2>Lotto sizing &amp; chain filter</h2>
          <p className="docs-note">
            <strong>Lotto sizing:</strong> 25–50% of standard play size. These are thesis bets, not conviction
            plays. Far-OTM 0DTE tickets expire worthless on most days — never size like a regular A-grade entry.
          </p>
          <p>
            <strong>Separate spread filter:</strong> Main plays use{" "}
            <code>SPX_CHAIN_MAX_SPREAD_PCT=18</code> (20% in the open window). Far-OTM lotto strikes at
            $0.30–$0.50 often quote 30–50% spreads — the main filter would reject every valid lotto. Lotto uses its
            own cap:
          </p>
          <pre className="docs-code">{`SPX_LOTTO_CHAIN_MAX_SPREAD_PCT=50   # default — wider than main plays
SPX_LOTTO_MIN_PREMIUM=0.20          # optional premium band floor
SPX_LOTTO_MAX_PREMIUM=0.85          # optional premium band ceiling`}</pre>
          <p>
            Engine picks the best far-OTM strike in the $0.20–$0.85 premium band with spread ≤ lotto cap. If no
            contract clears, the panel shows an estimated premium and a chain warning — still a watch thesis, not a
            forced entry.
          </p>
        </section>

        <section className="docs-section">
          <h2>Lotto panel UI</h2>
          <p>Shown below the main SCANNING block — independent of main play action:</p>
          <pre className="docs-diagram">{`┌─────────────────────────────────────┐
│  LOTTO WATCH                        │
│  CALL · Strike 5650 · ~$0.45        │
│  Target: +25 pts · Entry: SPX >5620 │
│  Catalyst: CPI today + gap +0.6%   │
│  Flow: $8.2M calls overnight        │
│  Status: Watching for open confirm  │
└─────────────────────────────────────┘`}</pre>
          <p>States: <strong>LOTTO WATCH</strong> → <strong>BUY LOTTO</strong> → <strong>LOTTO HOLD</strong> →{" "}
            <strong>LOTTO WIN</strong> / <strong>LOTTO STOPPED</strong>. Or: <strong>INVALIDATED</strong> → reversal
            scan → <strong>No lottos today</strong>.
          </p>
        </section>

        <section className="docs-section">
          <h2>Panel UI — main play block</h2>
          <ul className="docs-list">
            <li><strong>SCANNING headline</strong> — Rotating desk copy or play-idea intel.</li>
            <li><strong>Score / confidence</strong> — Raw confluence score and scaled confidence %.</li>
            <li><strong>Confirmations</strong> — Live 11-point checklist; persists across navigation via session cache.</li>
            <li><strong>Play idea line</strong> — Cyan actionable lean when gates block but direction is readable.</li>
            <li><strong>⛔ blocks</strong> — Hard reasons still blocking (cooldown, stale GEX, grade, opening range, etc.).</li>
            <li><strong>⚠ warnings</strong> — Non-blocking alerts: A+ buy-cooldown bypass, elevated VIX, adaptive score boost, starter disabled.</li>
            <li><strong>Entry / stop / target</strong> — Shown on BUY and open HOLD phases.</li>
            <li><strong>Option ticket</strong> — Strike, premium range, delta when chain data available.</li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>Data sources &amp; API endpoints</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Poll</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>/api/market/spx/desk</code></td>
                <td>~10s</td>
                <td>Full desk — GEX, flow, dark pool, news</td>
              </tr>
              <tr>
                <td><code>/api/market/spx/pulse</code></td>
                <td>~2s</td>
                <td>Fast price, internals, mega-caps</td>
              </tr>
              <tr>
                <td><code>/api/market/spx/flow</code></td>
                <td>~4s</td>
                <td>UW flow lane, GEX walls, dark pool</td>
              </tr>
              <tr>
                <td><code>/api/market/spx/play</code></td>
                <td>~3s</td>
                <td>Main play engine action</td>
              </tr>
              <tr>
                <td><code>/api/market/lotto/today</code></td>
                <td>60s / 10s</td>
                <td>Parallel lotto engine + history</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>Database tables</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>spx_open_play</code></td>
                <td>Current open 0DTE play (one at a time)</td>
              </tr>
              <tr>
                <td><code>spx_play_outcomes</code></td>
                <td>Entry/exit telemetry for main plays — adaptive gate tuning</td>
              </tr>
              <tr>
                <td><code>lotto_plays</code></td>
                <td>Lotto watch/buy/hold/sell history — separate from main plays</td>
              </tr>
              <tr>
                <td><code>platform_meta</code></td>
                <td>
                  Shared session KV store — <code>key TEXT PRIMARY KEY</code>,{" "}
                  <code>value TEXT</code> (JSON string), <code>updated_at</code>. Lotto live state uses key{" "}
                  <code>spx_lotto_record</code> (see <code>platform-meta-keys.ts</code> for full registry)
                </td>
              </tr>
              <tr>
                <td><code>spx_signal_log</code></td>
                <td>Signal audit trail</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="docs-section">
          <h2>platform_meta key registry</h2>
          <p>
            <code>platform_meta</code> is a <strong>shared key-value store</strong> — not lotto-specific columns.
            Each feature owns a namespaced key; values are JSON strings. Defined in{" "}
            <code>src/lib/platform-meta-keys.ts</code>:
          </p>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Owner</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>spx_lotto_record</code></td>
                <td>Lotto engine</td>
                <td>Live <code>LottoRecord</code> JSON (today only)</td>
              </tr>
              <tr>
                <td><code>spx_watch_record</code></td>
                <td>Main play engine</td>
                <td>WATCH→ENTRY scratch record</td>
              </tr>
              <tr>
                <td><code>spx_play_session_meta</code></td>
                <td>Main play engine</td>
                <td>
                  Cooldown timestamps — <code>last_sell_at</code>, <code>last_stop_at</code>,{" "}
                  <code>last_sell_was_loss</code>, <code>last_direction</code>, <code>last_buy_at</code>
                </td>
              </tr>
              <tr>
                <td><code>spx_claude_play_cache</code></td>
                <td>Claude gate</td>
                <td>Cached verdict</td>
              </tr>
              <tr>
                <td><code>spx_signal_log_cursor</code></td>
                <td>Signal log</td>
                <td>Dedup cursor</td>
              </tr>
              <tr>
                <td><code>uw_flow_cursor</code></td>
                <td>Flow ingest</td>
                <td>UW poll cursor</td>
              </tr>
            </tbody>
          </table>
          <p>
            Persistent lotto history lives in <code>lotto_plays</code> — <code>platform_meta</code> is only the
            in-flight state for today&apos;s poll loop.
          </p>
        </section>

        <section className="docs-section">
          <h2>Tuning reference (Railway env vars)</h2>
          <pre className="docs-code">{`# Main play gates
SPX_PLAY_FULL_MIN_SCORE=58
SPX_PLAY_STARTER_MIN_SCORE=48
SPX_PLAY_WATCH_MIN_SCORE=38
SPX_PLAY_PROMOTE_MIN_SCORE=48
SPX_PLAY_MIN_GRADE=B
SPX_PLAY_WEIGHTED_CONFLICT_BLOCK_MIN=4
SPX_PLAY_MIN_CONFIRMATIONS=6
SPX_PLAY_MIN_AGREEING_FACTORS=4
SPX_PLAY_ONLY_FULL_ENTRY=false
SPX_PLAY_OPENING_RANGE_MINUTES=15
SPX_PLAY_COOLDOWN_AFTER_STOP_MIN=20
SPX_PLAY_BUY_COOLDOWN_SEC=600
SPX_PLAY_BUY_COOLDOWN_APLUS_BYPASS=1
SPX_PLAY_REENTRY_LOCK_SEC=1200
SPX_PLAY_GEX_STALE_MAX_SEC=120

# Session cutoffs (independent)
SPX_PLAY_NO_ENTRY_ET_HOUR=15
SPX_PLAY_NO_ENTRY_ET_MIN=30
SPX_PLAY_FORCE_EXIT_ET_HOUR=15
SPX_PLAY_FORCE_EXIT_ET_MIN=50

# Claude arbiter
SPX_CLAUDE_GATE=1

# Open play management
SPX_PLAY_TRIM_MFE_PTS=12
SPX_PLAY_TRIM_PROGRESS_PCT=0.70
SPX_PLAY_THESIS_BREAK_SCORE=40
SPX_PLAY_THESIS_BREAK_DROP_PTS=12
SPX_PLAY_WATCH_MAX_AGE_MIN=30
SPX_PLAY_WATCH_EXTEND_AGE_MIN=45

# Option chain spread filter
SPX_CHAIN_MAX_SPREAD_PCT=18
SPX_CHAIN_MAX_SPREAD_PCT_OPEN=20
SPX_CHAIN_OPEN_SPREAD_MINUTES=30

# Lotto engine (parallel track)
SPX_PLAY_LOTTO_TARGET_PTS=25
SPX_PLAY_LOTTO_MAX_PICKS=2
SPX_PLAY_LOTTO_FLOW_MIN=5000000
SPX_PLAY_LOTTO_GAP_MIN_PCT=0.4
SPX_PLAY_LOTTO_CONFIRM_MOVE_PTS=8
SPX_PLAY_LOTTO_EXPIRE_ET_HOUR=10
SPX_PLAY_LOTTO_EXPIRE_ET_MIN=30
SPX_PLAY_LOTTO_MIN_DIRECTION_SIGNALS=3
SPX_LOTTO_CHAIN_MAX_SPREAD_PCT=50

# Adaptive telemetry (see Adaptive telemetry section)
SPX_OUTCOME_MIN_TRADES=8
SPX_OUTCOME_MIN_DAYS=14
SPX_ADAPTIVE_MIN_WIN_RATE=0.45
SPX_PROMOTE_UNDERPERFORM_GAP=0.15   # cold WR − promote WR; triggers +5 promote floor
SPX_PROMOTE_SCORE_BOOST=5           # points added to promote min when gap ≥ 0.15`}</pre>
        </section>
      </main>
    </div>
  );
}
