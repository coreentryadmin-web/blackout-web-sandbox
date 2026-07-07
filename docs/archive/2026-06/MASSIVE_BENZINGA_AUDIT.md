# Massive (Benzinga Partner) Endpoint Entitlement Audit

**Date:** 2026-06-26
**Method:** Empirical live probe (not docs-only). Every endpoint below was hit with our production Massive API key against the configured REST base URL, auth via `?apiKey=...`. HTTP status + real response body shape recorded. Docs cross-referenced from the Massive Benzinga partner docs.
**Probe ticker:** NVDA (liquid, full coverage), `limit=1`.
**Bottom line:** We are on a **News-only Benzinga plan.** `/benzinga/v2/news` returns 200. **Every structured Benzinga endpoint returns 403 `NOT_AUTHORIZED`** ("You are not entitled to this data. Please upgrade your plan"). The only accessible Benzinga data surface today is the news feed and its channels.

> No secrets in this document. The API key was passed only via a shell variable during probing and never printed, logged, or stored. The 403/200 bodies below contain request IDs and data, no credentials.

---

## 1. Entitlement matrix — structured endpoints

| Endpoint | Path | Method | Entitled | Key response fields | BlackOut use case |
|---|---|---|---|---|---|
| Real-time News | `/benzinga/v2/news` | GET | ✓ **200** | `benzinga_id`, `author`, `published`, `last_updated`, `title`, `url`, `images`, `channels`, `tickers`, `tags`, `teaser`, `body` | **In use.** Desk news rail/ticker, Largo `get_news`, Night Hawk dossier, Night's Watch position detail. The one surface we actually have. |
| Analyst Ratings | `/benzinga/v1/ratings` | GET | ✗ **403** | `ticker`, `date`, `analyst`, `firm`, `rating`, `rating_action`, `price_target`, `adjusted_price_target`, `price_target_action`, `importance` | Structured upgrade/downgrade + PT-change feed for Largo's `get_analyst_ratings`, desk catalyst tagging, Night Hawk overnight catalysts. Today approximated (poorly) via the news `analyst ratings` channel. |
| Consensus Ratings | `/benzinga/v1/consensus-ratings/{ticker}` | GET | ✗ **403** | `consensus_rating`, `consensus_rating_value` (1–5), `consensus_price_target`, `high_price_target`, `low_price_target`, `buy_ratings`, `hold_ratings`, `sell_ratings`, `ratings_contributors` | Single-number "Street consensus + PT range" for the desk header / Largo thesis context / Night's Watch position scoring. No news-channel equivalent. |
| Earnings | `/benzinga/v1/earnings` | GET | ✗ **403** | `ticker`, `company_name`, `date`, `time`, `actual_eps`, `estimated_eps`, `eps_surprise_percent`, `actual_revenue`, `estimated_revenue`, `revenue_surprise_percent`, `fiscal_period`, `fiscal_year`, `importance`, `date_status` | Structured earnings calendar + beat/miss surprise %, BMO/AMC timing. Drives Night Hawk evening plays, Night's Watch earnings-risk flags, Largo `get_earnings`. Today approximated via news `earnings` channel (headlines only, no structured EPS). |
| Analyst Details | `/benzinga/v1/analysts` | GET | ✗ **403** | `benzinga_id`, `full_name`, `firm_name`, `benzinga_firm_id`, `smart_score`, `overall_success_rate`, `overall_avg_return`, `overall_avg_return_percentile`, `total_ratings`, `total_ratings_percentile` | Analyst quality scoring — weight a rating by the analyst's historical hit-rate/return. Would let Largo say "a 78%-accuracy analyst just upgraded." No news equivalent. |
| Analyst Insights | `/benzinga/v1/analyst-insights` | GET | ✗ **403** | `ticker`, `company_name`, `date`, `firm`, `rating`, `rating_action`, `price_target`, `insight` (rationale text), `benzinga_firm_id`, `benzinga_rating_id` | Rating + price target **plus the written rationale**. Highest-value text for Largo to summarize "why" behind an analyst move. No news equivalent. |
| Bulls Bears Say | `/benzinga/v1/bulls-bears-say` | GET | ✗ **403** | `ticker`, `bull_case`, `bear_case`, `benzinga_id`, `last_updated` | Pre-summarized bull vs bear thesis per ticker — drop-in for a desk "two-sided view" card and Largo balanced framing. No news equivalent. |
| Corporate Guidance | `/benzinga/v1/guidance` | GET | ✗ **403** | `ticker`, `company_name`, `date`, `fiscal_year`, `fiscal_period`, `estimated_eps_guidance`, `min/max_eps_guidance`, `estimated_revenue_guidance`, `min/max_revenue_guidance`, `previous_*_guidance`, `positioning`, `importance`, `release_type`, `notes` | Structured company guidance (raise/cut vs prior) — a top overnight catalyst for Night Hawk; `positioning` field flags above/below street. Today only loosely visible via the news `guidance` channel. |
| Firm Details | `/benzinga/v1/firms` | GET | ✗ **403** | `benzinga_id`, `name`, `currency`, `last_updated` | Lookup table to resolve `benzinga_firm_id` → firm name. Only useful as a companion to ratings/insights (themselves 403). |

**403 response shape (identical for all structured endpoints):**
```json
{"status":"NOT_AUTHORIZED","request_id":"...","message":"You are not entitled to this data. Please upgrade your plan at https://massive.com/pricing"}
```

**200 news response shape:**
```json
{"status":"OK","request_id":"...","results":[{
  "benzinga_id":60134494,"author":"benzinga newsdesk",
  "published":"2026-06-26T17:01:24Z","last_updated":"2026-06-26T17:01:24Z",
  "title":"CNBC Halftime Report Final Trades: Meta, Uber, Enbridge, Nvidia",
  "url":"https://www.benzinga.com/quote/NVDA","images":[],
  "channels":["trading ideas","analyst ratings"],
  "tickers":["UBER","META","ENB","NVDA"],"tags":[]
}],"next_url":"https://market-data-api-host/benzinga/v2/news?cursor=..."}
```

---

## 2. News-channels matrix

Because the structured endpoints are 403, the **news channels are the real accessible Benzinga data surface.** Probed via `/benzinga/v2/news?tickers.any_of=NVDA&channels.any_of=<channel>&limit=1`. "Returns data" = at least one article came back for NVDA at probe time.

> **Channel names are space-delimited and lowercase.** The hyphenated/abbreviated forms `analyst`, `ratings`, and `analyst-ratings` all return **0 results** — the working name is `analyst ratings` (with a space). This matters: see the bug in §3.

| Channel | Returns data | What it carries | Use case |
|---|---|---|---|
| `analyst ratings` | ✓ | Upgrade/downgrade/PT-change headlines (the news echo of the structured ratings feed) | Catalyst tagging; closest available proxy for the 403 ratings endpoint |
| `price target` | ✓ | PT initiations/raises/cuts headlines | Same as above; PT-move flag for desk/Largo |
| `analyst color` | ✓ | Analyst commentary / color articles | Largo "what the street is saying" context |
| `upgrades` | ✓ | Upgrade-specific headlines | Bullish catalyst filter |
| `downgrades` | ✓ | Downgrade-specific headlines | Bearish catalyst filter |
| `earnings` | ✓ | Earnings headlines (no structured EPS numbers) | Earnings catalyst feed; Night Hawk/Night's Watch (numbers must be parsed from text) |
| `guidance` | ✓ | Guidance raise/cut headlines | Overnight catalyst; proxy for the 403 guidance endpoint |
| `dividends` | ✓ | Dividend declarations/changes | Income/event flags |
| `m&a` | ✓ | M&A / deal headlines | High-impact catalyst alerts |
| `ipos` | ✓ | IPO / SPAC headlines | New-listing watch |
| `movers` | ✓ | Notable price-move stories | Desk "why is X moving" rail |
| `after-hours center` | ✓ | After-hours movers & news | Night Hawk evening plays, post-close desk |
| `options` | ✓ | Unusual options / whale-activity stories | Cross-reference HELIX flow |
| `trading ideas` | ✓ | Trade-idea articles | Largo idea sourcing |
| `top stories` | ✓ | Editor-curated top stories | Headline rail prioritization |
| `buybacks` | ✓ | Share-repurchase news | Capital-return flag |
| `offerings` | ✓ | Secondary offerings / dilution | Dilution risk flag |
| `insider trades` | ✓ | Insider buy/sell news | Sentiment signal |
| `short sellers` | ✓ | Short-seller report news | Volatility/risk flag |
| `rumors` | ✓ | Rumor / speculation stories | Soft catalyst (low confidence) |
| `exclusives` | ✓ | Benzinga exclusive reporting | Differentiated content |
| `fda` | ✓ | FDA / regulatory (biotech) | Biotech catalyst feed |
| `economics` | ✓ | Macro / economic data news | Market-wide context |
| `government` | ✓ | Policy / government news | Macro/sector catalyst |
| `events` | ✓ | Scheduled-event coverage | Calendar context |
| `equities` / `markets` / `tech` / `futures` / `etfs` / `global` | ✓ | Broad section tags | Wide net / section filtering |
| `large cap` / `mid cap` / `small cap` | ✓ | Market-cap section tags | Universe filtering |
| `general` | ✓ | Uncategorized general news | Catch-all |
| `analyst` | ✗ (0) | — | **Not a valid channel** — use `analyst ratings` / `analyst color` |
| `ratings` | ✗ (0) | — | **Not a valid channel** — use `analyst ratings` |
| `analyst-ratings` | ✗ (0) | — | **Not a valid channel (hyphenated)** — use `analyst ratings` (space). Currently hard-coded in our code — see §3. |
| `pre-market` | ✗ (0) | — | No data for NVDA at probe time (may be empty off-hours or wrong slug) |

All channel probes returned **HTTP 200** (entitlement is at the endpoint level; an empty `results` array just means no match, not a permission block).

---

## 3. Entitled but NOT currently used (and a live bug)

What we pay for and can access today is **News (`/benzinga/v2/news`) only**, and we already consume it. The gap is not unused *endpoints* — it's **unused channels** plus a **channel-name bug** that silently returns nothing.

**Live bug — `analyst-ratings` channel name is wrong (returns 0 results):**
`src/lib/providers/polygon.ts:425`
```ts
export async function fetchBenzingaAnalystRatings(ticker: string, limit = 15) {
  return fetchBenzingaNews(limit, { ticker, channels: "analyst-ratings" }); // ← 0 results; should be "analyst ratings"
}
```
- The hyphenated `analyst-ratings` channel returns **0 results** on every probe; the working channel is `analyst ratings` (space).
- Blast radius: Largo's `get_analyst_ratings` tool (`src/lib/largo/run-tool.ts:772`) calls this as the **primary** source. It currently gets nothing from Benzinga and silently falls through to the UW screener fallback — so the "unlimited, no-rate-limit" primary path is dead. Fix: change the channel to `"analyst ratings"` (and consider also pulling `price target`, `upgrades`, `downgrades`, `analyst color`).

**Entitled-but-underused channels** (all 200, we don't consume them yet). Our code only ever passes `earnings`, the broken `analyst-ratings`, or no channel at all (raw feed). High-value channels we have access to but ignore:
- `guidance` — overnight guidance catalysts for Night Hawk (proxy for the 403 guidance endpoint).
- `m&a`, `offerings`, `buybacks` — high-impact corporate-action catalysts.
- `after-hours center`, `movers` — directly relevant to Night Hawk evening plays.
- `options` — cross-reference with HELIX flow.
- `price target`, `upgrades`, `downgrades`, `analyst color` — the real analyst-news surface (vs the broken `analyst-ratings`).
- `insider trades`, `short sellers`, `fda` — sentiment/risk/biotech catalyst filters.

**Recommendation:** these channels cost nothing extra (same entitled endpoint). Wire the high-value ones into Night Hawk / Largo / desk catalyst tagging, and fix the channel-name bug.

---

## 4. Needs a plan upgrade (403 today)

All of the **structured analyst/fundamentals endpoints** are 403 on the current News-only plan. Upgrading the Massive/Benzinga plan would unlock genuinely new, structured (machine-readable, no text-parsing) data:

| Endpoint | What upgrading unlocks (vs today's headline-only proxy) |
|---|---|
| `/benzinga/v1/ratings` | Structured upgrade/downgrade + exact old→new price target, per-firm, queryable by `rating_action` — instead of regexing headlines from the `analyst ratings` channel. |
| `/benzinga/v1/consensus-ratings/{ticker}` | One-call Street consensus (rating 1–5, avg/high/low PT, buy/hold/sell counts, # contributors). **No news-channel equivalent exists** — this is net-new. |
| `/benzinga/v1/earnings` | Structured EPS/revenue actual-vs-estimate, surprise %, BMO/AMC timing, fiscal period. Today we only get earnings *headlines* and must parse numbers from text. Directly upgrades Night Hawk, Night's Watch earnings-risk, Largo `get_earnings`. |
| `/benzinga/v1/guidance` | Structured guidance with `positioning` (above/below street) and prior-vs-new EPS/rev ranges. Today only loosely visible via the `guidance` news channel. |
| `/benzinga/v1/analyst-insights` | Rating + PT **plus written rationale** per analyst — best text for Largo to explain the "why." Net-new. |
| `/benzinga/v1/bulls-bears-say` | Pre-summarized bull/bear thesis per ticker — drop-in two-sided desk card. Net-new. |
| `/benzinga/v1/analysts` | Analyst quality scores (smart_score, success rate, avg return + percentile) to weight ratings by who made them. Net-new. |
| `/benzinga/v1/firms` | Firm name lookup; only useful alongside the (also-403) ratings/insights feeds. |

**Priority if upgrading:** `earnings` and `consensus-ratings` (highest desk/Night's Watch value and no usable proxy today), then `analyst-insights` / `bulls-bears-say` (richest Largo text), then `ratings` / `guidance` (we have a weak news-channel proxy now), with `analysts` / `firms` as enrichment.

---

## 5. Probe reference (reproducible)

```bash
# Key read into a shell var from .env.local; never printed.
CS=$(grep -E '^POLYGON_API_KEY=' .env.local | cut -d= -f2- | tr -d '"'"'"' \r')

# News (entitled, 200):
curl -s -w '%{http_code}' "https://market-data-api-host/benzinga/v2/news?tickers.any_of=NVDA&limit=1&apiKey=${CS}"

# Any structured endpoint (403):
curl -s -w '%{http_code}' "https://market-data-api-host/benzinga/v1/earnings?ticker=NVDA&limit=1&apiKey=${CS}"

# Channel (note the URL-encoded space %20):
curl -s -w '%{http_code}' "https://market-data-api-host/benzinga/v2/news?tickers.any_of=NVDA&channels.any_of=analyst%20ratings&limit=1&apiKey=${CS}"
```

Base `https://market-data-api-host`; auth `?apiKey=...`. Channel names are space-delimited, lowercase, URL-encode the space.

---

## Usage → Gap → Add-Plan (2026-06-26)

> Companion to §1–§5 above. §1–§5 answer **"what can we access"** (entitlement
> matrix). This section answers **"what do we actually USE, what are we MISSING
> within the plan, how do we ADD it, and is an UPGRADE worth paying for."**
> Written against **origin/main HEAD `be21109`**, verified live in source.

### 0. Corrections vs the earlier raw findings (and vs §3 above)

The earlier audit pass (and §3 "live bug" above) assumed the analyst-channel fix
and the dossier price-target wiring were still unmerged. **Both have since landed
on main.** Verified in source:

- **Analyst channel hyphen bug — FIXED.** `fetchBenzingaAnalystRatings`
  (`src/lib/providers/polygon.ts:429-432`) now passes the correct space-form
  comma-list `"analyst ratings,price target,upgrades,downgrades,analyst color"`.
  The dead hyphen `"analyst-ratings"` is gone from every **fetch** — it survives
  only in two **description strings** (`tool-defs.ts:150` and a polygon.ts code
  comment), which are cosmetic and should be corrected for accuracy. **§3's bug
  snippet (lines 94-102) is now historical, not live.**
- **Dossier price-target wiring — LANDED.** `fetchBenzingaPriceTarget` +
  `parsePriceTargetFromText` exist (`polygon.ts:533+`, `:479+`), pull the
  `price target` channel, and the dossier populates `analyst_summary` +
  `price_target` from the parsed PT (`dossier.ts:101, 400-401, 407`).
- **Grounding reconciles instead of blanket-stripping.** `grounding.ts:307-324`
  now reconciles prose PTs against the parsed `benzinga_price_target` (±tol)
  rather than always deleting them.

Net effect: the single highest-leverage fix from the prior audit is **already
done**. The remaining opportunity is **surfacing** (mount what's built) and
**breadth** (use more of the free channels), not bug-fixing.

### 1. HOW MUCH WE USE TODAY — usage map

Only **two** channel strings are ever passed in `src/`: `"earnings"` and the
analyst comma-list. Every other call hits the feed **channel-less**.

| Surface / call site | Channels | Status | Notes |
|---|---|---|---|
| `fetchBenzingaNews` core fetcher (`polygon.ts:389-418`) | caller-supplied | **USED** | The single real Benzinga surface; every other helper delegates here. |
| `fetchBenzingaEarnings` → Largo `get_earnings` (`run-tool.ts:748`), Night's Watch `position-detail.ts:198` | `earnings` | **USED** | Prose only; next-earnings *date* still from UW. |
| `fetchBenzingaAnalystRatings` → Largo `get_analyst_ratings` (`run-tool.ts:772`) | `analyst ratings,price target,upgrades,downgrades,analyst color` | **USED** *(was broken, now fixed)* | Now actually consumes Benzinga vs always falling through to the UW screener. |
| `fetchBenzingaPriceTarget` → dossier financials (`dossier.ts:101`) | `price target` | **USED** *(newly landed)* | Parses PT/firm/action; populates dossier `price_target` + `analyst_summary`. |
| Largo `get_news` / `toolNews` (`run-tool.ts:247-311`) | model-driven free-form | **USED** | Most flexible consumer; Benzinga-first merge over Polygon. |
| `/api/market/news` route (`route.ts:19`) | **none** | **PARTIAL** | `fetchBenzingaNews(15)`, channel-less. Only consumers are the two orphaned components below. |
| SPX desk news strip (`spx-desk.ts:837`) | **none** | **PARTIAL** | Computed `news_headlines` + fed to macro-events merge, **but renders only in admin debug JSON — not on the public desk.** |
| Night Hawk dossier per-ticker (`dossier.ts:300`) | **none** | **PARTIAL** | `fetchBenzingaNews(5,{ticker})`; titles only; teaser/body/channels discarded; no catalyst filtering. |

**Bottom line:** machinery healthy and headline bugs fixed, but **breadth is
tiny** — only `earnings` + the analyst list are requested by name; the flagship
after-hours product fetches the firehose channel-less.

### 2. HOW MUCH WE ARE MISSING — unused entitled channels (prioritized)

All free + unlimited on the current plan (same endpoint, different
`channels.any_of`). Grep confirms **zero** call-sites request any of these.

**Tier A — highest value / best fit (do first):**

- **`after-hours center`** — the **single best-fit unused channel.** Night Hawk
  builds the *next* session's edition *after the close*; earnings reactions,
  guidance cuts, halts live here. Today AH items appear only by luck in the
  channel-less feed. → Night Hawk `market-wide.ts` "After-Hours Wire."
- **`movers`** — NH derives movers only from UW flow + Polygon snapshots; no
  curated "why it's moving" narrative. → NH edition-wide + per-dossier "why it
  moved"; cross-ref `hot_chains`.
- **`m&a`** — highest-impact single-name gap catalyst, **completely absent**. →
  dossier flag + Night's Watch/watchlist alert.
- **`guidance`** — raises/cuts are pure per-ticker catalysts, invisible to
  dossier + alerts. → `guidance_events[]` → `scoreCandidate` + alert.
- **`short sellers`** — activist-short reports are major gap catalysts; dossier
  has only structural `short_days_to_cover`. → pair high-DTC + fresh report =
  squeeze/gap alert.
- **`insider trades`** — dossier insider data is **UW-only** (2 RPS cap);
  Benzinga is a **free corroborator** → relieves UW quota (cache-reader rule).
- **`fda`** — Largo `get_fda_calendar` is **UW-only + calendar-only**; no
  breaking approval/CRL/PDUFA news. → biotech dossiers + calendar complement.

**Tier B — solid value:** `offerings` (bearish dilution flag), `buybacks`
(bullish), `top stories` (curated macro lead for the desk strip + Largo
context), `ipos` (richer `get_ipo_calendar` fallback before web search),
`trading ideas` (Largo menu).

**Tier C — low value / enumerate-for-Largo only:** `dividends` (Polygon
structured already covers), `rumors` (noisy — label UNCONFIRMED, never score),
`exclusives`, `options` (redundant with UW/Polygon GEX), `economics`/`government`
(macro covered by macro-events), `events`.

**Cross-cutting gaps:**
- **`get_news` discoverability** — `get_news` takes a free-form `channels`
  string (`tool-defs.ts:152-158`) but enumerates **no channel names**, so Largo
  never knows it can request `after-hours center`/`movers`/`m&a`/`fda`/etc. The
  whole surface is reachable but **undiscoverable** to the model.
- **Alerts** — grep of `src/lib/alerts` + `src/app/api/cron` finds **zero**
  `fetchBenzinga`. The personalized-alerts scaffold (task #13) has no catalyst
  feed; these free channels make event alerts ~zero-cost.

### 3. HOW TO ADD IT — ordered add-plan (free items first)

Format: **channel → parse → surface → effort.**

**Cheapest wins (no new fetch, or one-line desc change):**

1. **Mount the dead news components.** `BenzingaNewsRail.tsx` /
   `BenzingaNewsTicker.tsx` (`src/components/desk/`) consume `/api/market/news`
   via `useSWR("benzinga-news")` but are **imported by nothing**. → Mount on the
   SPX desk. *XS.* The cheapest high-value win — makes the entitled feed render
   to users. If declined, delete both + the route.
2. **Enumerate channels in `get_news`** (`tool-defs.ts:152`): a one-line menu
   (`after-hours center, movers, guidance, m&a, buybacks, insider trades, short
   sellers, fda, offerings, ipos, top stories, trading ideas, analyst color,
   upgrades, downgrades, price target, rumors, exclusives`). *XS.* Unlocks the
   whole free surface for Largo with zero new fetch code. Also fix the two stale
   "analyst-ratings" description strings while here.
3. **Surface the SPX desk strip publicly** — `news_headlines` is computed
   (`spx-desk.ts:837`) but admin-only. Render it; pass
   `channels:"top stories,movers"` to sharpen the firehose. *S.*

**Night Hawk (after-hours thesis — marquee fit):**

4. **`after-hours center` + `movers` → NH edition** (`market-wide.ts`). Add
   `fetchBenzingaNews(25,{channels:"after-hours center,movers"})` alongside
   `fetchMarketNewsPreferPolygon`; map `ticker→headline`; surface an
   "After-Hours Wire" recap block + per-dossier "why it moved." *M.*

**Dossier catalyst broadening (ONE batched per-ticker call):**

5. **`m&a,guidance,short sellers,offerings,buybacks` → dossier** (fold into the
   `Promise.all` at `dossier.ts:300`). Parse into typed catalyst fields; feed
   `scoreCandidate` (m&a/short = gap risk, guidance ±, buyback = mild bullish,
   offering = bearish). *M.*
6. **`insider trades` → dossier corroborator** — cross-check
   `isRecentInsiderBuy()`; relieves UW quota. *S.*
7. **Catalyst-grade dossier news** — change the channel-less
   `fetchBenzingaNews(5,{ticker})` at `dossier.ts:300` to
   `channels:"analyst ratings,price target,upgrades,downgrades,guidance,m&a,fda"`.
   *XS (param only).*

**Largo tool enrichment:**

8. **`fda` → `get_fda_calendar`** (`run-tool.ts:799`) — breaking-news complement
   to the UW calendar. *S.*
9. **`ipos` → `get_ipo_calendar`** (`run-tool.ts:801`) — fallback **before** web
   search. *S.*
10. **`top stories` → market context** (`market-wide.ts`
    `fetchMarketNewsPreferPolygon`). *S.*

**Alerts (depends on #5/#6):**

11. **Catalyst alerts** off the new dossier channels (m&a, guidance, downgrades,
    short sellers, fda, offerings) → per-holder (Night's Watch) + per-watchlist.
    *M.* Free channels → ~zero-cost event alerts.

**Verify after #5-#7:** confirm the UW screener fallback at `run-tool.ts:775`
stops firing for Benzinga-covered tickers, reclaiming UW RPS for
flow/tide/dark-pool.

### 4. UPGRADE ANALYSIS — the 403 structured endpoints

(Endpoint detail in §1 + §4 above. This is the **pay-or-not** verdict, weighing
each 403 against its accessible news-channel proxy. Priority 1 = highest.)

| 403 endpoint | Net-new vs proxy? | Verdict | Priority |
|---|---|---|---|
| `/v1/consensus-ratings/{ticker}` | **YES — no proxy.** Channels echo single headlines; UW `predictions-consensus` is *crowd* consensus, not Street. Dossier carries one parsed PT, not a range. | **MUST-HAVE if upgrading.** Real consensus PT range + buy/hold/sell split nothing accessible reproduces → ticker header, Largo thesis, NW scoring. | **1 (tie)** |
| `/v1/analyst-insights` | **YES — no proxy.** `analyst color` is generic articles, not per-rating rationale. Richest text payload. | **MUST-HAVE for Largo.** Answers "*why* did Firm X upgrade" in the analyst's words. | **1 (tie)** |
| `/v1/ratings` | **Partial — strongest proxy already wired** (`fetchBenzingaPriceTarget` parses PT from `price target` channel; grounding reconciles). | **NICE-TO-HAVE.** Buys structured old→new PT + reliable action filtering, kills regex fragility. Only if PT-parse proves too noisy. | **2** |
| `/v1/earnings` | **No — UW covers it** (`fetchUwEarnings*` gives structured beat/miss/est/timing). | **NICE-TO-HAVE.** Only if NH/NW earnings-risk scaling against the 2 RPS UW budget becomes the bottleneck. | **3** |
| `/v1/guidance` | **Weak proxy** — `guidance` channel accessible but not yet wired; structured `positioning` (above/below street) has no headline equivalent. | **Do the FREE win first** (add-plan #5). Upgrade only if `positioning` becomes a needed deterministic NH signal. | **3** |
| `/v1/bulls-bears-say` | **YES — no proxy at all.** | **NICE-TO-HAVE.** Differentiated but editorial, not numeric. Pursue after the numeric endpoints → desk bull/bear card + Largo balanced framing. | **4** |
| `/v1/analysts` | **YES — no proxy.** But useless alone (enrichment on the 403 ratings/insights). | **Enrichment only** — never upgrade alone; bundle with a ratings/insights tier, then weight signals by analyst track record. | **4** |
| `/v1/firms` | Companion lookup for the (403) feeds. | **SKIP as a standalone target** — comes free with any ratings/insights tier. | **lowest** |

**Upgrade recommendation:** the only two endpoints that are net-new, have **no
substitute**, AND carry a numeric trading signal are **`consensus-ratings`** and
**`analyst-insights`** (Priority 1). If a paid tier is pursued it should bundle
both (they typically drag `ratings`/`firms`/`analysts` along). Everything else is
covered (earnings via UW; ratings/PT via the now-working `price target` proxy) or
is editorial color. **Before paying, exhaust the free channel wins in §3 —
especially `guidance`, `after-hours center`, `movers` — since they cost nothing
on the current entitlement.**

### 5. Executive summary

We use the News-only entitlement at ~**two channels out of ~25**; the prior
audit's headline bugs (analyst hyphen, blank dossier PT) are **already fixed on
main**. The real gap is **breadth + surfacing**: the best-fit channels for our
flagship after-hours product — **`after-hours center` and `movers`** — are
completely unconsumed; the two built Benzinga news components are **unmounted
dead code**; the SPX desk strip renders **admin-only**; and Largo can't
**discover** the free channel menu. Add-plan is free-first: mount the components,
enumerate channels for Largo, then wire `after-hours center`/`movers` into Night
Hawk and a batched `m&a/guidance/short sellers/offerings/buybacks/insider trades`
catalyst pull into the dossier + alerts — all $0 on the current plan. **Only two
403 endpoints justify paying — `consensus-ratings` and `analyst-insights` — and
only once the free channels are exhausted.**
