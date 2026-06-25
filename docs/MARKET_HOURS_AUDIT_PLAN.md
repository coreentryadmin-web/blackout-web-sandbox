# BlackOut — Pre-Production Live-Data Audit Plan (market hours)

**Goal:** prove the live site is 100% real — every value correct, every service healthy, every tool consistent with the others — by validating continuously throughout market hours, not once. Autonomous; no asking.

**Window:** 6:30 AM – 1 PM PT (US RTH: 9:30 AM – 4 PM ET). A recurring cron fires every ~30 min and runs this routine each time. Findings accumulate in `docs/audit-log-<YYYY-MM-DD>.md` (append each cycle).

---

## A. PRE-MARKET (finish + arm before 6:30 AM PT)
- [ ] Heatmap rework deployed + verified: 2 paired views (Profile+Matrix / Curve+Shift), Magnet rename (gold pin), consolidated key-levels box, per-day Magnets across the Matrix.
- [ ] Cross-tool "GEX KING" → Magnet rename done (SPX desk tile + Night's Watch chip).
- [ ] All commits deployed, `next build` green, no regressions (re-run the QA sweep if needed).
- [ ] Dummy Night's Watch positions open for the RTH valuation test (a long call, a long put, a short — varied) so #74 can be verified live.
- [ ] Baseline admin health captured (rate limiters, WS, Redis, Postgres) so deltas are visible.
- [ ] Market-hours audit cron armed (durable). Machine + Claude must stay running for it to fire.

## B. EACH CYCLE (every ~30 min while OPEN) — run ALL of these
If market is CLOSED (before 6:30 / after 1 PM PT / weekend): do a light infra check (admin health) + log + stop.

### 1. Data correctness — verify EVERY value populates and is sane (not "—", not stale, not fabricated)
- **SPX desk** (/dashboard): price, %chg, VIX, VWAP, GEX, EMA 20/50/200, SMA 50/200, HOD/LOD/PDH/PDL, regime, γ-flip, max pain, IV rank, GEX walls (strikes + signed $), live tape, P&L. Every number tabular, sign-correct, in a sane range.
- **HELIX** (/flows): live tape (ticker/strike/type/premium/dte/OTM/direction), CALL=emerald / PUT=bear, premium never `$-X` (sign outside), Net Premium leaderboard, Sector Flow, LIVE badge truthful (not "LIVE" while stale).
- **Heatmap** (/heatmap): GEX walls, matrix cell values + diverging color, Magnet (overall + per-day per column), spot/flip lines, consolidated key-levels box, both paired-view tabs, every lens (GEX/VEX/DEX/CHARM).
- **Night's Watch** (/nighthawk): the dummy positions VALUE during RTH — P&L, Greeks (Δ/Θ/IV), Mark, breakeven, verdict (HOLD/TRIM/SELL/WATCH) all populate (no "UNAVAILABLE"). This proves #74.
- **Largo** (/terminal): grounded, correct answers (right ticker, right levels — watch for SPX/SPY confusion #73).

### 2. Cross-tool consistency (the integration proof)
- The same GEX walls / Magnet / spot / flip / key levels render IDENTICALLY across Heatmap ↔ SPX desk ↔ Night's Watch detail ↔ Largo. A put wall is a put wall everywhere (net_gex sign, #80). The Magnet strike matches across all tools (argmax|net_gex|).
- Spot price agrees across every surface. No tool shows a level another contradicts.

### 3. Infra / rate limits / data integrity / sovereignty
- Admin health (/admin or /api/admin/health): UW (≤2 RPS cluster-wide) — no 429s / circuit-breaker trips; Polygon/Massive — no errors; Redis — connected, no ETIMEDOUT; Postgres — no pool exhaustion / errors; WebSockets (options + polygon) — connected + fresh (not stale-churning).
- No fabricated values (missing data → "—", never a fake 0 / now()). No sub-AA contrast on live numbers. Launch gating intact (locked tools 403 for non-admins; admin bypass). No data leaking into URLs/embeds.

### 3b. Realtime-update validation (EVERY cycle, all RTH days — is the site auto-updating with NO manual refresh?)
- For 2–3 rotating tool pages (SPX desk / HELIX / Heat Maps / Night's Watch), confirm the numericals AUTO-UPDATE without a manual refresh. Method: in the browser bridge run `performance.getEntriesByType('resource')` and confirm the page is RE-FETCHING its data endpoints on the expected cadence — Heat Maps matrix `/api/market/gex-heatmap` ~20s + quote `/api/market/quote` ~1.5s; Night's Watch `/api/account/positions` ~5s (RTH); SPX desk spot via live WS. OR read a rendered value, wait ~25–40s, re-read, confirm it changed.
- GOTCHA: SWR pauses `refreshInterval` while the tab is hidden (`document.visibilityState==='hidden'`) — a CDP-driven tab reads hidden, so judge cadence by the resource-timing / code, not by "it didn't change while hidden". `revalidateOnFocus:true` (heatmap) means it refreshes on tab-return.
- FLAG any surface that is refresh-only (fetches once, never re-polls), whose poll fired but the VALUE is frozen (cache not warming → cron/staleness issue), or that lags the live underlying beyond its cache TTL.
- The one-time faster-update DESIGN (poll→SSE/WS push, free cache-polling, the rate-limit-safety proof) is a separate research deliverable; THIS recurring step just proves the auto-update keeps working day-to-day across the week.

### 4. Mock interactions (exercise the lifecycle live)
- Place 1-2 dummy Night's Watch trades (vary call/put/long/short) → confirm they value within a cycle; then clean up extras (keep one for the running #74 check).
- Ask Largo 2-3 RANDOM questions (a level, a position read, a "what's the gamma setup") → confirm answers are grounded in live data + numerically correct + cite the right ticker.
- Confirm HELIX tape + SPX desk are actually ticking (values change between cycles).

### 5. Log + escalate
- Append findings to `docs/audit-log-<date>.md`: timestamp, surface, ✅/⚠️/❌ per check, any wrong/stale/inconsistent value with evidence.
- FIX high-confidence correctness bugs immediately (validate tsc+build, commit, push) — except risky/ambiguous ones, which get flagged for review.
- Re-verify across cycles: a value seen once is not enough — confirm it stays correct over multiple cycles before calling it real.

## C. Spin up agents for the deep pass
Each cycle, in addition to the browser checks, launch a small validation workflow (5-8 agents) over disjoint dimensions: data-correctness, cross-tool consistency, rate-limit/infra, number-format/sign, security/sovereignty, mock-trade lifecycle. Synthesize → fix-list → fix the confirmed. Bounded per cycle (not unbounded) to stay within reason; coverage compounds across cycles.
</content>
