# BlackOut — API Integration Map

Per-provider inventory of what we USE, what's available-but-UNUSED-and-valuable, and the open
opportunity/reliability gaps. Maintained by the `api-integration-audit` job (daily). Drive gaps → 0.

**Last full pass:** 2026-06-26 (7-agent doc-grounded deep pass). Open flagged tasks: see TaskList #1–#9.

Legend: ✅ used/correct · 🟡 unused-but-valuable · 🔴 suboptimal/reliability gap · 🛡️ verified-strength.

---

## Polygon.io / Massive REST (`api.massive.com`)
Base: `POLYGON_API_BASE ?? https://api.massive.com`; key `POLYGON_API_KEY ?? MASSIVE_API_KEY`. All REST
flows through `polygonTrackedFetch` → cluster rate-limiter (`POLYGON_GLOBAL_MAX_RPS`, default 40) +
circuit breaker (`POLYGON_CIRCUIT_*`). polygon.io now 301-redirects to massive.com (vendor merger).

**✅ USED:** stock snapshots/movers (`/v2/snapshot/.../{gainers,losers}`), index snapshot
(`/v3/snapshot/indices`), options chain snapshot (`/v3/snapshot/options/{u}`, GEX/VEX/DEX/CHARM
backbone), unified per-contract snapshot (`/v3/snapshot?ticker.any_of=`, NW valuation, ≤250/call),
contracts reference (`/v3/reference/options/contracts`), aggregates/prev/grouped, indicators
(`/v1/indicators/{ema,sma,rsi,macd}`), market-status, last NBBO/trade, reference
(tickers/dividends/splits/ipos/news), Benzinga news, short-interest/volume/float, financial ratios.

**🟡 UNUSED-valuable:** options **Trades WS `T`** channel (native flow tape — would reduce UW
dependence; [doc](https://massive.com/docs/websocket/options/trades)); `break_even_price` per contract
(returned, discarded — fixture already has it); `day.volume` per contract in GEX (today OI-only; volume
is fresher than 1-day-lagged OI); FMV WS/REST channel (synthetic mid for quoteless deep-OTM strikes);
`/v3/reference/conditions` (decode trade-condition codes to exclude odd-lot/multileg from flow volume).

**🔴 GAPS:**
- Pagination guards (`fetchHeatmapBand` <16, `fetchChainBand` <8, IV-term <20, OI <12) truncate the
  chain when `next_url` is still set → understated walls/OI/IV. **Observability signal SHIPPED**
  (`9b51d88`, `warnChainTruncated` after all four loops — no longer silent). REMAINING value-changing
  follow-up: raise caps / fully follow `next_url` so the chain is *complete* (changes GEX magnitudes +
  upstream cost → flagged, human call).
- `×100` contract multiplier hardcoded in all GEX terms — no `shares_per_contract` guard (adjusted
  contracts corrupt notional). **→ Task #9.**
- `POLYGON_GLOBAL_MAX_RPS` default 40 is unverified vs the real plan cap; with Redis down + N replicas,
  cluster emits up to 40N RPS. **→ Task #8.**
- Indicator endpoints called where bars already in hand (9 extra calls/ticker in MTF technicals).

**✅ Fixed this pass:** `fetchIndexRsi` now null-safe (try/catch) like the other indicator getters
(was the only one that threw into callers on a blip). `49cb17d`.

---

## Massive WebSocket (options + indices)
`wss://socket.massive.com/{indices,options}`. Auth `{"action":"auth","params":KEY}` then subscribe.

**✅ USED:** indices socket — `A.*` (1s aggs) + `V.*` (tick value) for I:SPX/VIX/VIX9D/VIX3M/TICK/
TRIN/ADD (single connection, correct). Options socket — `Q.*` quotes (NW live position marks; gated by
`OPTIONS_WS_ENABLED`); auth handshake + `bp/ap/bs/as` fields doc-verified.

**🟡 UNUSED-valuable:** options **`T` trades** (true last-trade marks + lets the stall watchdog tell
"no quotes" from "no trades"); per-contract option snapshot REST (cheap WS-quiet fallback); `AM.O:`
per-minute option aggregates (NW sparkline without REST polling); FMV (Business-plan only).

**🔴 GAPS / 🛡️:**
- **GEX uses REST chain only** — the WS feed does NOT feed GEX (correct, by design). 🛡️
- vanna/charm recomputed via closed-form BS (`r=q=0` assumption) — unavoidable (Massive doesn't publish
  them); GEX/DEX correctly use provider greeks. Documented caveat, not a bug. 🛡️

**✅ Fixed this pass:** `OPTIONS_WS_MAX_CONNS` default **10 → 1**. Massive's documented default
entitlement is ONE WS connection per asset class; the old default would boot-loop the instant held
contracts exceed one shard. Overflow degrades to the REST snapshot fallback. Raise only after
confirming a multi-connection entitlement with Massive support. `49cb17d`. *(close-code→auth mapping is
empirical; left the reconnect backoff as-is — hard-stop on authFailed risks a permanent outage if a
transient close is misclassified, and the 60s backoff already bounds the retry rate.)*

---

## Unusual Whales (UW)
2-RPS cluster-wide (Redis Lua sliding-window limiter + cross-replica breaker). HELIX flow + SPX desk.

**✅ USED — 10 WS channels:** `flow_alerts`, `market_tide`, `off_lit_trades`, `interval_flow`,
`trading_halts`, `net_flow` (ticker-scoped), `option_trades`, `lit_trades`, `gex_strike_expiry` (SPX),
`price` (SPX/SPY). Massive **stocks LULD** (`STOCKS_WS_ENABLED`) is a second halt source vs UW
`trading_halts`. ~90 REST fetchers via the 2-RPS limiter. WS-first cache bridge skips cron when channels
are fresh (Task #6 partial). Desk pulse/flow expose **lit/dark ratio** from lit + dark WS stores.

**🟡 UNUSED-valuable:** WS `gex_strike` (non-expiry), `news` (Benzinga primary), `contract_screener`;
REST full-tape / volatility-anomaly surface. Massive options **Trades WS `T`** now dual-subscribed with Q
(NW marks + stall liveness).

**🔴 GAPS (remaining):**
- `news`, `contract_screener` still unused on UW WS (news intentionally off — Benzinga).
- Massive FMV / unified snapshot batch opportunities (see Polygon section).

**✅ Fixed (2026-06-30):** Task #7 partial — LULD + dual-source halt staleness. Task #6 partial — WS-first
`uw-cache-refresh`, `option_trades` tape. `interval_flow` keyed by ticker. Flow-per-strike cron capped at 500.
`aggregateGexRows` uses `shares_per_contract`. SPX play RSI uses Massive `/v1/indicators/rsi`. UW `price`
WS + FOMC minutes/decision parse fix + lit/dark ratio on desk.

---

## Anthropic (Claude API) — Largo desk + SPX commentary
`@anthropic-ai/sdk ^0.105.0`. Models: `claude-sonnet-4-6` (Largo, NW narrative), `claude-haiku-4-5`
(SPX commentary). **All model IDs current/valid — no deprecated IDs.**

**✅ USED:** streaming tool-loop (`messages.stream` + `finalMessage`), manual agentic tool-use with
per-result size cap, structured outputs via `output_config.format` (canonical API), system prompt
caching (`cache_control:ephemeral` + auto-detect floor), cross-replica Redis spend ledger + opt-in
kill-switch (fails closed), typed `APIError` handling, retries/timeouts, telemetry on every call. 🛡️

**🟡 UNUSED-valuable:** Messages **Batches API** (50% cheaper — for the overnight edition/critic/
explainer, the largest latency-tolerant calls; **→ Task #5**); `count_tokens` for token-based budgeting;
fallback model on 529 overload.

**🔴 GAPS:**
- Largo's per-question tool filtering (`getToolsForIntent`) varies the tools prefix every turn →
  invalidates the whole prompt cache, so the 5KB system prompt cache never reads. **→ Task #4** (biggest
  caching defect). • SPX commentary (every 5min) concatenates stable instructions + volatile JSON into
  one uncached prompt — split into a cached `system`. • `refusal` and `max_tokens` stop_reasons not
  detected (degrade silently — no telemetry to distinguish from timeout/malformed).

**✅ Fixed this pass:** strip `temperature` for Opus-4.7+/Fable models (they 400 on sampling params) so
an `ANTHROPIC_MODEL` override to an Opus/Fable model no longer 400s every call. `49cb17d`.

---

## Clerk — authentication (sole user store)
`@clerk/nextjs ^7.5.8`. Tier lives in Clerk `publicMetadata.tier`; `userId` keys all per-user data.

**✅ USED:** `clerkMiddleware` with explicit protected-route allow-list (all `/api/*` self-authorize),
`ClerkProvider dynamic` + Frontend-API preconnect, server `auth()`/`clerkClient()`, `requireTier`/
`requireTierApi` shared resolver that **fails closed** on a Clerk outage (never over-grants). 🛡️ No
`NEXT_PUBLIC` secret leakage (verified clean).

**🟡 UNUSED-valuable:** `user.created/updated/deleted` **webhook** → store sync (**→ Task #1**, top
finding — still missing); session-token custom claims to carry `tier` (drop the per-request `getUser()`
that the tier-cache exists to mitigate); Clerk Organizations / `auth().has({role})` for admin gating.

**🔴 GAPS:** no `user.deleted` cleanup → orphaned per-user Redis/PG keys leak forever + GDPR gap (**→
Task #1**); admin gating still does an uncached per-request `getUser()`.

---

## Whop — billing / membership
`@whop/sdk 0.0.40` (**this IS the latest** — current Stainless SDK, not outdated). Membership →
`publicMetadata.tier` → tier gates. Launch-gating (`LAUNCHED_TOOLS`) is SEPARATE from Whop.

**✅ USED:** signed webhook (`whop.webhooks.unwrap()` = Standard-Webhooks HMAC-SHA256, ±5min tolerance —
verified correct 🛡️; **missing-secret path returns 503 to force retries**, better than ack-and-drop),
`members.list`/`memberships.list` resolution, refund/dispute → revocation denylist + immediate re-sync,
hourly reconcile cron. 🛡️ asymmetric fail-closed/fail-open tier logic.

**🟡 UNUSED-valuable:** `payment.failed`/`invoice.past_due` (dunning nudge to cut involuntary churn);
multi-tier Pro/Elite mapping (env vars read but collapsed to single `premium`).

**🔴 GAPS:** revocation denylist is Redis-only + fail-open → a Redis flush re-grants premium to refunded
users (**→ Task #2**, revenue leak); no `event.id` idempotency/replay dedup (**→ Task #3**); heavy sync
runs synchronously before webhook ACK (timeout/retry risk); checkout prices are hardcoded UI labels
(drift vs Whop product config → dispute risk).

**✅ Fixed this pass:** handle `membership.cancel_at_period_end_changed` (real-time grace re-sync) +
assert `event.company_id === WHOP_COMPANY_ID` (defense-in-depth, ack-drop on definite mismatch). `49cb17d`.

---

## Infra — Redis (ioredis 5.11.1) · Postgres (pg 8.21.0) · Railway
**🛡️ Prior CRITICAL RESOLVED:** pg Pool `'error'` handler present (`db.ts:106-111`) — no replica-crash.

**✅ USED:** Redis `family:0` (Railway IPv6 internal DNS — load-bearing, do not remove) + mandatory
`'error'` listener on all 8 clients; pg Pool (`max` default 5, `idleTimeout`, `connectionTimeout`,
context-aware SSL); fully parameterized queries (`$n`, identifier interpolation allow-listed); atomic
Lua rate-limiters; advisory-lock-serialized migrations. 🛡️

**🟡 UNUSED-valuable:** pipelining / `enableAutoPipelining`; `maxUses`/`maxLifetimeSeconds` connection
recycling; `allowExitOnIdle` for one-shot cron services; `keepAlive` on the pool.

**🔴 GAPS:** UW limiter fail-OPEN correctness depends on `REPLICA_COUNT` being set accurately (**→ Task
#8**); `connectionTimeoutMillis:15s` on the live pool is long; `fetchRecentFlows` heavy per-row JSONB
extraction (indexed, but unbounded projection time — now bounded by statement_timeout below).

**✅ Fixed this pass:** added `statement_timeout` + `query_timeout` to the live PG Pool
(`PG_STATEMENT_TIMEOUT_MS`, default 30s) — a blocked/slow query can no longer pin a connection and
exhaust the 5-slot pool. Added Redis `reconnectOnError` READONLY guard (free managed-tier failover
insurance, no-op on single-node Railway Redis). `49cb17d`.

---

## Open-gap scoreboard (drive → 0)
| # | Provider | Gap | Sev | Status |
|---|---|---|---|---|
| 1 | Clerk | Missing user.* webhook + orphan cleanup | P1 | flagged |
| 2 | Whop | Revocation denylist not durable (revenue leak) | P1 | flagged |
| 3 | Whop | No webhook idempotency/replay dedup | P1 | flagged |
| 4 | Anthropic | Largo tool filtering kills prompt cache | P1 | flagged |
| 5 | Anthropic | Batches API for overnight gen (50% off) | P2 | flagged |
| 6 | UW | Adopt option_trades/gex WS (cut REST polling) | P1 | flagged |
| 7 | UW | Single-source halt gate SPOF | P1 | flagged |
| 8 | Infra/ops | Verify REPLICA_COUNT + Polygon RPS cap env | P1 | flagged |
| 9 | Massive | shares_per_contract in GEX math | P2 | flagged |

**Closed this pass (→ main `49cb17d`):** PG statement/query timeout · Redis reconnectOnError · polygon
fetchIndexRsi null-safe · Massive OPTIONS_WS_MAX_CONNS default 1 · Anthropic temperature guard · Whop
cancel-toggle handling + company_id assertion.
