# BLACKOUT — Production Runtime Findings (live Railway logs, 2026-06-24)

Evidence the static code audit cannot see: issues observed in actual production logs from the running
Railway container (Next.js 14.2.35, single replica). Three distinct issues; two fixed in this pass,
one flagged for a deliberate fix.

---

## RT-1 — Options-socket stall→reconnect storm (Night's Watch live marks) — **FIXED** (commit a9eb3dc)

- **Severity:** High (reliability / connection churn).
- **Business impact:** Night's Watch live option marks drop out for ~10–20s every ~14 min while the
  shard thrashes; at scale the repeated reconnects waste the per-key WS connection budget and can
  cascade into the same 1008/1006 collision class we saw on the indices socket.
- **Technical impact:** Recurring cycle (observed 13:53, 14:07, 14:22 UTC): `stall watchdog — OPEN but
  no data for ~105s, reconnecting` → reconnect collides with the still-closing old socket → `code=1006`
  with escalating backoff (failures 1→4) → eventually re-auths and re-subscribes, stable ~14 min, then
  repeats.
- **Root cause:** `src/lib/ws/options-socket.ts` — `lastMessageAt` advanced **only** on a priced quote
  (`handleQuote`, was line ~406). A single held contract that is quiet/illiquid receives no NBBO update
  for >90s during normal trading, so a perfectly-alive socket read as a "stall". The 90s threshold plus
  a 1s reopen (before Massive released the old connection) produced the 1006 storm.
- **Code reference (before):**
  ```ts
  // handleQuote — liveness only tracked on a priced quote:
  const now = Date.now();
  this.lastMessageAt = now;
  // WATCHDOG_STALL_MS default 90_000; reconnectIfStalled reconnectDelay = 1000
  ```
- **Fix applied:** (a) track liveness on **any** inbound frame in `handleMessage` (connected / auth /
  status / subscribe-ack / heartbeat / quote); (b) raise default `OPTIONS_WS_STALL_MS` 90s → **300s** (a
  genuine half-open is rare once liveness isn't quote-only, and the mark gap falls back to the REST
  snapshot); (c) post-stall `reconnectDelay` 1s → **3s** so Massive releases the old connection before we
  reopen. Harmless at scale (busy contracts keep liveness fresh); fixes the low/quiet-contract case.

---

## RT-2 — SPX-play hard-502 on Massive connectivity blip — **FLAGGED** (needs deliberate fix)

- **Severity:** High (core feature availability).
- **Business impact:** During a ~30s `market-data-api-host` connectivity blip (13:19 UTC) the SPX play (a flagship
  tool) returned **HTTP 502** with no fallback. At 500–1000 concurrent users, any transient Massive/DNS/
  network blip becomes a wall of 502s on the primary feature simultaneously.
- **Technical impact (observed):**
  ```
  [market/spx/play] TypeError: fetch failed
    [cause]: ConnectTimeoutError: Connect Timeout Error (attempted address: market-data-api-host:443, timeout: 10000ms)  code: UND_ERR_CONNECT_TIMEOUT
  ... then: Error: connect EHOSTUNREACH 198.44.194.59:443  errno: -113
  ```
  The route's Promise.all of upstream fetches rejects, and `src/app/api/market/spx/play/route.ts:35-39`
  `catch (error) → return NextResponse.json(..., { status: 502 })` — i.e. **no stale-serve, no retry**.
- **Root cause:** the Massive/Polygon REST fetch has a 10s connect timeout (undici default) but no
  retry/backoff for connect-level failures, and connect errors (`UND_ERR_CONNECT_TIMEOUT`, `EHOSTUNREACH`)
  do not feed the Polygon circuit breaker (which tracks 429s), so the route hard-fails instead of degrading.
- **Recommended fix:** on upstream failure, **serve the last-known-good cached play (stale)** with a
  `degraded: true` flag instead of 502; add a short retry with jittered backoff for connect-level errors;
  and route connect failures through the circuit breaker so a Massive outage trips it once rather than
  every request paying the 10s timeout. Example shape:
  ```ts
  try { return fresh; }
  catch (e) {
    const stale = await getStaleSpxPlay();           // last good from server-cache / redis
    if (stale) return NextResponse.json({ ...stale, degraded: true }, { status: 200 });
    return NextResponse.json({ error: "Upstream temporarily unavailable" }, { status: 503 }); // retryable, not 502
  }
  ```
- **Not fixed here:** requires a deliberate stale-serve contract across the spx-play builder + cache layer;
  scoped into the audit's Backend/Scalability remediation (see 03-BACKEND.md / 09-SCALABILITY.md).

---

## RT-3 — `DISCORD_OPS_WEBHOOK_URL not set` logged every ~20 min — **FIXED** (commit a9eb3dc) + config TODO

- **Severity:** Low (log noise + ops-channel hygiene).
- **Business impact:** Ops/critical alerts fall back to the **play (trade) channel**, mixing infra noise into
  the trader-facing channel; and the warning spams stderr on every alert.
- **Root cause:** `src/lib/spx-play-notify.ts:44` logged the fallback warning on **every** `notifyOpsDiscord`
  call.
- **Fix applied:** log the fallback warning **once per process** (module-level guard).
- **Config TODO (user):** set `DISCORD_OPS_WEBHOOK_URL` in Railway so ops alerts route to a dedicated ops
  channel, separate from `DISCORD_PLAY_WEBHOOK_URL`.

---

## RT-4 — UW multiplex `code=1006` reconnect — **informational** (self-healed)

- **Severity:** Low / informational.
- The UW multiplex socket closed once (`code=1006`) at 13:24 UTC and **immediately reconnected** and rejoined
  channels. The reconnect logic works as designed; noting it only as a baseline for the WS-resilience review
  (a 1006 is an abnormal close with no close frame — expected occasionally on long-lived sockets).

---

## RT-5 — Polygon `/v1/indicators/{ema,sma}` reject the `I:SPX` index ticker — **FIXED** (commit cca04f0)

- **Severity:** High (core SPX-desk data completeness + recurring SLA noise + wasted API timeouts).
- **Business impact:** The SPX desk's moving averages (EMA 20/50/200, SMA 50/200) silently went **null** —
  a flagship "institutional desk" surface was missing standard MA levels traders expect, while the admin SLA
  monitor showed a steady stream of `Request failed` for these endpoints.
- **Technical impact (observed in the admin SLA monitor):**
  ```
  POLYGON  /v1/indicators/ema/I:SPX   ×3   Request failed
  POLYGON  /v1/indicators/sma/I:SPX   ×2   Request failed
  ```
  The ×3 ema + ×2 sma map exactly to the desk's 5 indicator calls (`spx-desk.ts:781-785`:
  `fetchIndexEma 20/50/200` + `fetchIndexSma 50/200`). `latestIndicator` (`polygon.ts`) catches the failure
  and returns `null`, so the desk degrades but logs every failure + pays the per-call connect timeout.
- **Root cause (CORRECTED after checking the docs):** The indicator endpoints **DO support index tickers.**
  Massive documents `GET /v1/indicators/{sma,ema,macd,rsi}/{I:TICKER}` as **"Included in all Indices plans"**,
  and the code's call (`window` / `timespan` / `series_type=close` / `order` / `limit`) matches the documented
  params. My initial diagnosis ("indices unsupported," *inferred* from the older VWAP-not-for-indices comment
  at `polygon.ts:626`) was an **incorrect inference** — corrected after the user pointed to the Massive REST
  docs. The "Request failed" entries were **transient**: the same `market-data-api-host` connectivity blip as RT-2
  (the SLA badge stayed **"OK · SLA"** = occasional failures within tolerance, not a broken endpoint).
- **Fix applied (revised):** `fetchIndexEma`/`fetchIndexSma` now use the **documented Massive indices
  endpoint as PRIMARY** (server-computed, full history, one call — most accurate), and fall back to the
  bars-derived MA (pure, unit-tested `src/lib/providers/ma-math.ts`) **only when the endpoint returns null** —
  so a transient Massive blip no longer leaves the desk MAs blank. Non-index (stock) callers unchanged.
- **The real systemic cause is the same as RT-2:** transient `market-data-api-host` connectivity affects ALL
  Massive calls (indicators, aggs, snapshots). The durable fix is connect-level **retry/backoff + circuit
  breaker** on the Massive fetch path (audit priority **R-16**; `api-tracked-fetch` retries are opt-in/default
  0 today). The bars fallback is a belt-and-suspenders for the MA path specifically.
- **Lesson:** verify provider behavior against the **docs/a live probe** before inferring "unsupported" from
  an adjacent code comment.
