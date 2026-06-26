# Massive (Benzinga Partner) Endpoint Entitlement Audit

**Date:** 2026-06-26
**Method:** Empirical live probe (not docs-only). Every endpoint below was hit with our production `POLYGON_API_KEY` (a Massive key) against `https://api.massive.com`, auth via `?apiKey=...`. HTTP status + real response body shape recorded. Docs cross-referenced from `https://massive.com/docs/rest/partners/benzinga/<slug>`.
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
}],"next_url":"https://api.massive.com/benzinga/v2/news?cursor=..."}
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
curl -s -w '%{http_code}' "https://api.massive.com/benzinga/v2/news?tickers.any_of=NVDA&limit=1&apiKey=${CS}"

# Any structured endpoint (403):
curl -s -w '%{http_code}' "https://api.massive.com/benzinga/v1/earnings?ticker=NVDA&limit=1&apiKey=${CS}"

# Channel (note the URL-encoded space %20):
curl -s -w '%{http_code}' "https://api.massive.com/benzinga/v2/news?tickers.any_of=NVDA&channels.any_of=analyst%20ratings&limit=1&apiKey=${CS}"
```

Base `https://api.massive.com`; auth `?apiKey=...`. Channel names are space-delimited, lowercase, URL-encode the space.
