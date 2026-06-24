# BLACKOUT — WebSockets API Audit (DOCS-GROUNDED)

> Scope: ALL real-time WebSocket feeds we can consume. Two providers:
> **MASSIVE** (Polygon-compatible; `wss://socket.massive.com/{cluster}`) and
> **UNUSUAL WHALES** (`wss://api.unusualwhales.com/socket`).
> Every fact below is read line-by-line from the **official docs** (Massive
> `https://massive.com/docs/websocket/{cluster}/{feed}.md` + the docs index
> `https://massive.com/docs/llms.txt`; UW `https://api.unusualwhales.com/docs`
> with `Accept: text/plain` and per-channel `/docs/operations/PublicApi.SocketController.*`).
> Audited 2026-06-24. **Rule honored: behavior is quoted from docs, never inferred from code comments** (that exact mistake caused incident RT-5).

---

## 0) Critical docs-vs-code finding (read this first)

The Massive WebSocket documentation **does NOT contain an authentication page, a
connection-limits page, a rate-limit page, or a getting-started/connect page**.
The docs index (`llms.txt`) lists *only* per-feed pages; there is no
`websocket/overview` (it 404s) and no `authentication`/`rate-limit` entry anywhere
in the index. Each per-feed page that I fetched explicitly reads **"Connection
Limits: Not documented"** — with the SINGLE exception of the per-connection
contract cap on Options Quotes/FMV.

Consequences for our code (all NOT VERIFIED against Massive docs — these come from
code/empirics, not the official docs):

- The connect→`auth`→`auth_success` handshake we implement in
  `polygon-socket.ts` / `options-socket.ts` is **NOT in the Massive docs**. It is
  the legacy Polygon protocol. It works empirically but is undocumented by Massive
  → **NOT VERIFIED — needs a Massive "WebSocket authentication / getting started"
  doc page or a live probe.**
- Our `MAX_CONNECTIONS = 10` per-key cap for the options pool (`options-socket.ts`
  line 48, "Massive ~10/connection limit") is **NOT in any Massive doc**. The docs
  only state the **1,000-contracts-per-connection** cap. → **NOT VERIFIED — the
  "10 connections per key" number is folklore; needs a Massive limits page or a
  live probe before we trust it for capacity planning.**
- Massive documents **no** reconnect/heartbeat/keepalive guidance and **no** close
  codes. Our `1008/4401/4403 = auth-failure` and `1006 = transient` mappings are
  **NOT VERIFIED — needs a Massive limits/close-code doc or a live probe.** This is
  directly load-bearing for RT-1 (see §5).

UW, by contrast, **does** document the connect handshake, the join frame, the
ok-ack shape, and the per-channel schemas — but also documents **no** connection
count limit, **no** subscription cap, **no** heartbeat, and **no** close codes.
The only hard UW number in the docs is throughput sizing (`option_trades` =
"6–10M records per day"). Plan gate is documented: **"Websocket access for
personal use is only available through the Advanced plan."**

---

## 1) MASSIVE WebSocket — full surface (3 clusters in scope + 3 we don't trade)

WS cluster URLs (from our `polygon-docs-nav.ts`, matching Massive's host; the
per-feed doc pages show only the relative form e.g. `WS /options/Q`):
`wss://socket.massive.com/{stocks,options,indices}` (also `/crypto`,`/forex`,`/futures`).

Subscription syntax (all clusters): `{"action":"subscribe","params":"<EV>.<TICKER>"}`
where `<EV>` is the event code below and ticker uses the cluster prefix (`I:` indices,
`O:` options, bare for stocks; `*` = all). Comma-separate for multiple.

### 1a. INDICES cluster `wss://socket.massive.com/indices`  — WE USE THIS

| Feed | Event / sub | Purpose | Key schema fields (verbatim) | Used? (where) | Plan / limits (doc) | Recommendation |
|---|---|---|---|---|---|---|
| Aggregates Per Second | `A.I:TICKER` | 1-sec OHLC bars for an index | `ev,sym,op,o,c,h,l,s,e` (`op`="Today's official opening value", `s/e`=window start/end Unix ms) | ✅ `polygon-socket.ts` L108-117 subscribes `A.I:SPX,VIX,VIX9D,VIX3M,TICK,TRIN,ADD`; consumes `A`/`AM` | "Included in select Indices plans" → **Indices Advanced/Business real-time**; conn limits **Not documented** | KEEP. Note we subscribe 7 symbols but `indexStore` only seeds those 7 — fine. |
| Aggregates Per Minute | `AM.I:TICKER` | 1-min OHLC bars for an index | same as `A` with `ev:"AM"` | ✅ consumed as fallback (`ev==="AM"`) in `polygon-socket.ts` L117; not explicitly subscribed | Indices Starter(15-min delayed)/Advanced/Business | KEEP. |
| **Value** | `V.I:TICKER` | **Raw tick index value** (not a bar) | `ev,val`("value of the index"),`T`(ticker),`t`(Unix ms) | ⬜ **UNUSED** | "Indices Starter (15-min delayed), Advanced, Business" | **OPPORTUNITY:** the `V` feed is the true tick-level SPX/VIX print; today we derive `price` from the 1-sec bar `c` (up to ~1s stale + a bar-gap on reconnect, per our own comment). Switching the live SPX/VIX number to `V` removes the sub-second lag for the SPX pulse/desk and gives a cleaner day-change anchor. |

### 1b. OPTIONS cluster `wss://socket.massive.com/options`  — WE USE THIS (Quotes only)

| Feed | Event / sub | Purpose | Key schema fields (verbatim) | Used? (where) | Plan / limits (doc) | Recommendation |
|---|---|---|---|---|---|---|
| **Quotes** | `Q.O:CONTRACT` | NBBO bid/ask per option contract | `ev,sym,bp`(bid price)`,ap`(ask price)`,bs`(bid size)`,as`(ask size)`,bx`(bid exch)`,ax`(ask exch)`,t`(Unix ms)`,q`(seq) | ✅ `options-socket.ts` — live marks engine; reads `bp/ap` (mid) for Night's Watch P&L | "Options Advanced" (indiv) / "Options Business + Expansion"; **"You're only allowed to subscribe to 1,000 option contracts per connection."** | KEEP. Our `bp/ap` field reading is now **DOC-VERIFIED** (code previously said fields "not fully pinned"; they ARE: `bp`/`ap`/`bs`/`as`). We can drop the `bid`/`ask` alias guesses. |
| **Trades** | `T.O:CONTRACT` | Tick-level option prints (the raw tape) | `ev,sym,x`(exch)`,p`(price)`,s`(size)`,c`(conditions)`,t,q` | ⬜ **UNUSED** | Options Developer/Advanced/Business+Expansion (Dev=15-min delayed) | **OPPORTUNITY:** a Massive-native option tape independent of UW. Gives us a second source for SPX 0DTE print confirmation and a fallback if UW `option_trades`/flow stalls — directly hardens the flow pipeline. |
| Aggregates Per Second | `A.O:CONTRACT` | 1-sec OHLCV bars per contract | `ev,sym,v,av,op,vw,o,c,h,l,a,z,s,e` | ⬜ **UNUSED** | Options Starter/Dev/Advanced/Business+Expansion | OPPORTUNITY: live per-contract volume/VWAP for held SPX legs without REST polling (intraday contract-volume spikes on our own positions). |
| Aggregates Per Minute | `AM.O:CONTRACT` | 1-min OHLCV bars per contract | same as `A` | ⬜ **UNUSED** | as above | Minor; the `A` second-bars cover this. |
| **Fair Market Value** | `FMV.O:CONTRACT` (URL `/business/options/FMV`) | Massive's proprietary real-time fair value of a contract | `ev,fmv,sym,t`(nanosecond ts) | ❓ **NEEDS-PLAN-ACCESS** | **Options BUSINESS only — "Not included" in Basic/Starter/Developer/Advanced** | **OPPORTUNITY (gated):** an independent theoretical mark for illiquid/wide-spread SPX contracts where bid/ask mid is unreliable. Would improve Night's Watch valuation on deep-OTM lotto strikes. Requires Options Business plan — confirm our entitlement before building. |

### 1c. STOCKS cluster `wss://socket.massive.com/stocks`  — ENTIRELY UNUSED

| Feed | Event / sub | Purpose | Key schema fields (verbatim) | Used? | Plan / limits (doc) | Recommendation |
|---|---|---|---|---|---|---|
| Quotes | `Q.TICKER` | NBBO for a stock | `ev,sym,bx,bp,bs,ax,ap,as,c,i,t,q,z`(tape) | ⬜ UNUSED | Stocks Advanced (indiv) / Business; limits Not documented | OPPORTUNITY: live SPY/QQQ NBBO as a millisecond proxy/cross-check for the SPX index value. |
| Trades | `T.TICKER` | Tick stock prints | `ev,sym,x,i,z,p,s,ds,c,t,pt,q,trfi,trft` | ⬜ UNUSED | Stocks Developer/Advanced/Business | OPPORTUNITY: SPY tape for confirming index moves; ETF lit tape to complement UW dark-pool. |
| Aggregates Per Second | `A.TICKER` | 1-sec stock bars | `ev,sym,v,dv,av,dav,op,vw,o,c,h,l,a,z,s,e,otc` | ⬜ UNUSED | Stocks Starter/Dev/Advanced/Business+Exp | OPPORTUNITY: live SPY/sector-ETF candles for the desk without REST. |
| Aggregates Per Minute | `AM.TICKER` | 1-min stock bars | same as `A` | ⬜ UNUSED | as above | Minor. |
| **Fair Market Value** | `FMV.TICKER` (`/business/stocks/FMV`) | Proprietary real-time fair value of a stock | `ev,fmv,sym,t` | ❓ NEEDS-PLAN-ACCESS — **Business only** | Stocks Business only | OPPORTUNITY (gated): fair-value anchor for ETFs. |
| **LULD** | `LULD.TICKER` | Limit Up–Limit Down bands: "signal when securities approach or breach dynamic price bands, triggering pauses, halts, or resumptions" | `ev,T,h`(high band)`,l`(low band)`,i,z,t,q` | ⬜ UNUSED | **Stocks Advanced / Business+Expansion (real-time)** | **OPPORTUNITY:** a SECOND, Massive-native halt/volatility-band signal independent of UW `trading_halts`. Cross-sourcing this directly de-risks RT-style "halt feed stale → entries blocked" fail-closed events (we currently have a single halt source). |
| **NOI (Net Order Imbalance)** | `NOI.TICKER` | NYSE auction imbalance at open/close (clearing price + imbalance qty) | `ev,T,t,at`(planned auction time)`,a`(auction type)`,i,x,o`(imbalance qty)`,p`(paired qty)`,b`(book clearing price) | ❓ NEEDS-PLAN-ACCESS — **"Imbalances Expansion" plan only** | Imbalances Expansion (indiv/business) | OPPORTUNITY (gated): MOC/auction imbalance for SPY/large caps — a known intraday-reversal edge near the close. |

> Massive also exposes **crypto / forex / futures** WS clusters (same feed shapes).
> Out of scope for an SPX options-flow platform; listed here only for completeness.

---

## 2) UNUSUAL WHALES WebSocket — full surface (14 channels)

- **URL:** `wss://api.unusualwhales.com/socket?token=<YOUR_API_TOKEN>` (verbatim).
- **Auth:** token in the query string (verbatim example above). REST docs also show
  `Authorization: Bearer YOUR_API_KEY`. Our code additionally sends a
  `UW-CLIENT-API-ID` header (`uw-socket.ts` L262) — **NOT in the docs**, harmless.
- **Join frame (verbatim):** `{"channel":"option_trades","msg_type":"join"}` →
  server acks `["option_trades",{"response":{},"status":"ok"}]`. Multiplex: multiple
  `join` frames on one socket are explicitly supported ("You can join multiple
  channels with the same websocket connection").
- **Message envelope (verbatim):** `[<CHANNEL_NAME>, <PAYLOAD>]`.
- **Plan gate (verbatim, every channel):** "Websocket access for personal use is
  only available through the **Advanced plan**."
- **Limits in docs:** connection count = **not documented**; channels per socket =
  **not documented** (multiplex encouraged); heartbeat/close codes = **not
  documented**. Only throughput sizing is given: `option_trades` = **"6–10M records
  per day"**. The JS example uses `reconnect=5` (5s reconnect); the AI "skill" page
  recommends "Reconnect loop with exponential backoff, resubscribe on reconnect."

> **Wire-name gotcha (DOC-VERIFIED):** the docs name the alerts channel
> **`flow-alerts`** (hyphen) and `option_trades`/`gex` etc. with underscores. Our
> code joins `flow_alerts` (underscore) via `CHANNEL_JOIN_NAME` and only normalizes
> hyphens→underscores on the *inbound* wire name (`channelFromWireName`). If UW
> requires the hyphen on the *join*, our `flow_alerts` join could silently no-op.
> → **NOT VERIFIED that `flow_alerts` (underscore) is an accepted join alias — needs
> a live probe / confirm against the api-examples repo.** Flag for the flow-pipeline owner.

| Channel | Wire name | Purpose | Key payload fields | Used? (where) | Plan / limits | Recommendation |
|---|---|---|---|---|---|---|
| Flow alerts | `flow-alerts` | Rule-matched aggregated flow alerts (all, unfiltered) | `id,rule_name,ticker,option_chain,total_premium,has_sweep/floor/multileg,ask_vol/bid_vol,trade_ids,bid,ask,...` | ✅ `uw-socket.ts` L570 → `persistAndPublishFlowAlert` | Advanced; no count limit | KEEP — core of HELIX flow. |
| Market tide | `market_tide` | Market + OTM tide (net call/put premium) | `net_call_premium,net_put_premium,...` | ✅ `uw-socket.ts` L595 → `tideStore` | Advanced | KEEP. Doc note: also carries **OTM tide** — we only read the overall tide; OTM split is an unused sub-signal. |
| Off-lit trades | `off_lit_trades` | Dark-pool prints | dark-pool snapshot rows | ✅ `uw-socket.ts` L616 → `darkPoolStore` | Advanced | KEEP. |
| GEX (ticker) | `gex:TICKER` | Dealer Greek $-exposure per 1% move, ticker-aggregate | `gamma/delta/charm/vanna_per_one_percent_move_{oi,vol,dir}`,`price` | ✅ `uw-socket.ts` L628 → `gexStore` (we join base `gex`) | Advanced | KEEP — but see below: we likely want the **strike-level** variant. |
| **GEX by strike** | `gex_strike:TICKER` | Greek exposure **per strike** (call/put split, OI + vol + bid/ask-side) | `call_gamma_oi,put_gamma_oi,...,strike,price,*_ask_vol,*_bid_vol` | ⬜ **UNUSED** | Advanced | **OPPORTUNITY:** per-strike dealer gamma is exactly what a GEX-wall / pin / flip-level product needs. Our MEMORY notes GEX walls come from Massive chain math today; this channel is the *native UW dealer-positioning wall feed* with bid/ask-side attribution we don't compute ourselves. Top candidate. |
| **GEX by strike & expiry** | `gex_strike_expiry:TICKER` | Same, additionally split by expiry | `...,expiry,strike,...` | ⬜ **UNUSED** | Advanced | **OPPORTUNITY:** 0DTE-vs-monthly gamma separation for SPX — isolate the 0DTE gamma wall that actually pins intraday. Directly serves the SPX desk. |
| Net flow | `net_flow:TICKER` | Live net call/put prem + volume aggregates | `net_call_prem,net_call_vol,net_put_prem,net_put_vol,time` | ✅ `uw-socket.ts` L640 → `netFlowStore` (SPX) | Advanced | KEEP. |
| Interval flow | `interval_flow` | Per-5min ticker flow stats (sweeps, floors, multileg, Greek flow, IV, net prem) | `ticker,interval_type,call_vol,put_vol,transactions,call_vol_ask_side,...` | ✅ `uw-socket.ts` L651 → `intervalFlowStore` | Advanced | KEEP — doc confirms this is the volume/IV-spike alerting feed. |
| Trading halts | `trading_halts` | Halts / resumes / LULD pauses per ticker | halt events (`symbol,active,...`) | ✅ `uw-socket.ts` L663 → `tradingHaltsStore` (fail-closed gate) | Advanced | KEEP — single point of failure; pair with Massive `LULD` (see §1c). |
| **Option trades** | `option_trades` / `option_trades:TICKER` | The full live option tape: **"6–10M records per day"**; per-trade Greeks + NBBO + tags | `id,underlying_symbol,executed_at,nbbo_bid/ask,size,price,option_symbol,tags,open_interest,iv,delta,theta,gamma,vega,trade_code,exchange,ask_vol,bid_vol,...` | ⬜ **UNUSED** | Advanced; **6–10M/day** | **OPPORTUNITY (biggest):** the raw per-trade tape. `flow-alerts` only gives us UW's *rule-matched aggregates*; `option_trades:SPX` gives the **un-aggregated print stream** so we can build our OWN flow rules, exact-time sweep reconstruction, and back the `trade_ids` referenced by flow alerts. Use the `:TICKER` form (SPX/SPY) to stay well under the firehose. |
| **Price** | `price:TICKER` | Live last-trade price + cumulative volume | `close`(last price)`,time,vol` | ⬜ **UNUSED** | Advanced | **OPPORTUNITY:** a UW-native live underlying price for SPY/SPX in the same socket as flow — removes a Massive round-trip and keeps price+flow time-aligned on one feed. |
| **News** | `news` | Live headlines incl. **Truth Social** posts; `is_trump_ts` flag | `headline,timestamp,source,tickers,is_trump_ts` | ⬜ **UNUSED** | Advanced | **OPPORTUNITY:** real-time headline/Truth-Social tape with a `@realDonaldTrump` filter — a known SPX/VIX intraday catalyst. High-signal, low-volume, easy to ship as a desk ticker/alert. |
| **Lit trades** | `lit_trades` | Live exchange (lit) equity prints | `symbol,price,size,volume,trade_code,sale_cond_codes,executed_at,nbbo_bid/ask,...` | ⬜ **UNUSED** | Advanced | OPPORTUNITY: lit equity tape to pair with `off_lit_trades` for a true lit-vs-dark ratio on SPY/large caps. |
| **Contract screener** | `contract_screener` | Live hot-contract snapshots = the options-screener page feed | `option_symbol,volume,open_interest,prev_oi,premium,ask/bid_side_volume,iv,delta,gamma,theta,vega,days_of_oi_increases,sweep_volume,...` | ⬜ **UNUSED** | Advanced | **OPPORTUNITY:** a live, server-computed options screener (Greeks + OI-growth + side volumes) we can surface directly as a "hot contracts" product without polling REST `/screener/*`. |
| **Custom alerts** | `custom_alerts` | **Per-user** stream of alerts matching that token's UW notification configs | `name,noti_type,user_noti_config_id,user_id,symbol,symbol_type,tape_time,meta` | ⬜ **UNUSED** | Advanced; **per-token/per-user** | OPPORTUNITY (ops): mirror our own UW account's configured alerts in-app. Per-user/per-token, so it cannot fan out to all BLACKOUT users on one key — useful for internal/desk alerting only. |

---

## 3) Utilization snapshot

- **MASSIVE WS feeds available (stocks+options+indices in scope): 16.** Used: **3**
  distinct feeds (indices `A`, indices `AM` passively, options `Q`). → **~19% of the
  in-scope Massive WS surface.** Two more (`FMV`, `NOI`) need a Business/Expansion plan.
- **UW WS channels available: 14.** Used: **7** (`flow-alerts, market_tide,
  off_lit_trades, gex, net_flow, interval_flow, trading_halts`). → **50%.**
- **Combined in-scope WS surface: 30 feeds/channels; we use 10 → ~33% utilization.**

---

## 4) Top missed-data opportunities (ranked, concrete)

1. **UW `gex_strike` / `gex_strike_expiry:SPX`** — native per-strike dealer gamma
   walls with bid/ask-side attribution and 0DTE/monthly separation. Replaces/validates
   our self-computed GEX walls; the single highest-value SPX-desk add.
2. **UW `option_trades:SPX` (+ `:SPY`)** — the raw 6–10M/day print tape. Lets us build
   our own flow rules, reconstruct sweeps exactly, and resolve `flow-alerts.trade_ids`.
3. **Massive options `T` (Trades)** — a Massive-native option tape; second source that
   hardens the flow pipeline if UW stalls (RT-class resilience).
4. **Massive stocks `LULD`** — second, independent halt/volatility-band signal to
   de-risk the single-source `trading_halts` fail-closed gate.
5. **UW `news`** — real-time headline + Truth-Social (`is_trump_ts`) catalyst tape;
   low-volume, high-signal desk feed.
6. **UW `price:SPY`/`:SPX`** — UW-native live underlying on the same socket as flow,
   time-aligned, removes a Massive round-trip.
7. **UW `contract_screener`** — live server-side hot-contracts screener (Greeks +
   OI-growth) shippable as a product without REST polling.
8. **Massive indices `V` (Value)** — true tick-level SPX/VIX value vs our 1-sec-bar
   `c` derivation; removes sub-second lag + the reconnect bar-gap on the pulse/desk.

> Gated (confirm plan first): Massive options/stocks **`FMV`** (Business) for
> fair-value marks on wide-spread strikes; Massive **`NOI`** (Imbalances Expansion)
> for MOC auction-imbalance edge.

---

## 5) Rate limits & gotchas — strictly from the docs (+ what's NOT in them)

**Documented (quote-backed):**
- **Massive options Quotes & FMV:** "You're only allowed to subscribe to **1,000
  option contracts per connection**." (per-feed doc, verbatim). → our
  `MAX_CONTRACTS_PER_CONN = 1000` (`options-socket.ts` L43) is **DOC-CORRECT**.
- **Massive options Quote fields:** `bp/ap/bs/as/bx/ax/t/q` are the documented names
  (verbatim). → our defensive `bid`/`ask` aliasing is unnecessary; `bp`/`ap` is canonical.
- **Plan gating:** every UW WS channel — "Websocket access for personal use is only
  available through the **Advanced plan**." Massive real-time WS requires the
  **Advanced** (indices/options/stocks) tier; `FMV` requires **Business**; `NOI`
  requires **Imbalances Expansion**.
- **UW throughput:** `option_trades` = "**6–10M records per day**"; sample client uses
  `reconnect=5` (5s); skill page recommends exponential-backoff reconnect + resubscribe.

**NOT documented anywhere (tie to our incidents — treat as NOT VERIFIED):**
- **No Massive auth-handshake doc.** Our connect→`auth`→`auth_success` flow is the
  legacy Polygon protocol, undocumented by Massive. NOT VERIFIED — needs a Massive
  getting-started doc or live probe.
- **No Massive "max connections per key."** Our `MAX_CONNECTIONS = 10` is folklore
  ("Massive ~10/connection limit"), **not in any doc**. NOT VERIFIED — a live probe
  is the only way to confirm the real cap before scaling the options pool past 10
  shards (10×1000 = 10k contracts). If the true cap is lower, scaling silently fails.
- **No Massive heartbeat/keepalive/close-code doc.** This is directly load-bearing
  for **RT-1** (options-WS stall watchdog false-firing on quiet contracts) and the
  **1008/1006 collisions**: the docs neither define a server heartbeat nor say what
  `1006`/`1008` mean here, so our watchdog/`stallMs` tuning and our
  `1008/4401/4403=auth` mapping rest on empirics, **not docs**. NOT VERIFIED —
  needs a Massive close-code/keepalive doc or a live probe. The current mitigation
  (any-inbound-frame liveness + 5-min `WATCHDOG_STALL_MS` + 3s reopen delay so the
  old socket releases before reconnect) is the correct empirical workaround, but it
  cannot be validated against docs.
- **No UW connection-count or channels-per-socket limit, no UW heartbeat, no UW
  close codes.** Our `1008/4401/4403`→auth-failed mapping and the 30s
  heartbeat/stall watchdog in `uw-socket.ts` are empirical. NOT VERIFIED — needs a
  UW limits/close-code doc or a live probe.
- **UW join wire-name (`flow-alerts` hyphen vs our `flow_alerts` underscore)** — see
  §2 gotcha. NOT VERIFIED that the underscore form is an accepted join alias; confirm
  against the api-examples repo or a live probe, since a silent no-op here would
  starve the flow pipeline.

**Net:** the ONE hard, doc-backed limit on our entire WS surface is **1,000
contracts per Massive options connection**. Every other limit/handshake/close-code
assumption we encode is undocumented and should be labeled empirical until a live
probe or a (currently missing) Massive limits page confirms it.
