# Audit — Batch 5: Market Data Providers + WS

Scope read: spx-session.ts, flow-ingest.ts, flow-persist.ts, db.ts
(insertFlowAlert/fetchRecentFlows), ws/uw-socket.ts (status/staleness/halts).
Remaining provider files partially covered — see "Pending".

---

## 🟠 MEDIUM 1 — Flow-ingest cursor mixes ISO and epoch timestamps

**File:** `src/lib/providers/flow-ingest.ts:59-62, 41`
```
const created = String(raw.created_at ?? raw.start_time ?? flow.alerted_at ?? "");
if (created && (!newestCursor || created > newestCursor)) newestCursor = created;
...
fetchMarketFlowAlertRows({ ..., newer_than: cursor })
```
**Bug:** The cursor is built from `raw.created_at` (ISO string) OR `raw.start_time`
(epoch number-as-string) depending on which the row has. These are compared
**lexicographically** (`created > newestCursor`) and then sent back to UW as
`newer_than`. Mixing `"2026-06-19T20:01:00Z"` and `"1718830860"` breaks ordering
(`"1..." < "2..."`), so the cursor can stall or jump, and UW receives a value in a
format it may not expect.

**How it fails:** Intermittent **missed or duplicated alerts** depending on which
fields UW populates — directly weakens flow streaks, candidate selection, signals.

**Fix:** Use the normalized ISO value consistently — `flow.alerted_at` (already
normalized to ISO in `parseUwFlowAlert`) — for both the cursor and comparison.
Never mix `start_time` epochs into the cursor.

**Test:** Feed rows where some have only `start_time` (epoch) and some only
`created_at`; assert the cursor advances monotonically in ISO and no alert in the
overlap window is dropped.

---

## 🟠 MEDIUM 2 — "WS OPEN" ignores staleness → silent flow stop

**Files:** `flow-ingest.ts:25-29`, `ws/uw-socket.ts:307-321`
```
// flow-ingest
if (wsStatus["flow_alerts"] === "OPEN") return { ...skipped: "ws_active" };
// uw-socket getStatus(): "OPEN" iff authenticated — does NOT check lastMessageAt
```
**Bug:** REST ingest is skipped whenever the WS channel reports `OPEN`, but `OPEN`
only means the channel **authenticated** — not that data is flowing. The socket can
be half-open / silent (UW-side hiccup, dead TCP) while still reporting `OPEN`. The
per-channel `lastMessageAt.flow_alerts` IS tracked (uw-socket.ts:442) but **never
consulted** here.

**How it fails:** A stalled-but-authenticated socket → REST never runs as backup →
**flow ingestion silently stops** while the admin shows the channel green. Flow
streaks freeze, candidates go stale, no alarm.

**Fix:** Treat WS as live only if `lastMessageAt.flow_alerts` is recent during
market hours (e.g. < 120s). Expose a `isChannelFresh(channel, maxAgeMs)` helper and
gate the REST skip on it; otherwise fall back to REST polling.

**Test:** Simulate `authenticated=true` with `lastMessageAt` 5 min old → ingest
must run REST, not skip.

---

## 🟡 LOW-MED 3 — Trading-halt gate fails open if channel down/stale

**File:** `ws/uw-socket.ts:412-419` (`hasActiveTradingHalt`)
**Bug:** The Night Hawk halt gate returns `false` (nothing halted) whenever the
`trading_halts` channel never connected or went stale — the `halts` map is simply
empty. There's no freshness/recency check on the halt store.

**How it fails:** If the halts channel is down, Night Hawk can recommend a **halted
stock** (fail-open). Low frequency, but it's a credibility/$$ risk on the exact
case the gate exists to prevent.

**Fix:** If `trading_halts` is not fresh (no message within N minutes during market
hours), treat halt status as **unknown** and have Night Hawk degrade conservatively
(e.g., fetch a REST halt check for the final 5 tickers, or flag "halt status
unverified").

---

## 🟡 LOW 4 — RTH filter includes the 16:00 bar

**File:** `spx-session.ts:83` — `return mins >= 9*60+30 && mins <= 16*60;`
RTH close is 16:00; a bar stamped 16:00 is the 16:00–16:01 minute (post-close).
`<=` includes one after-hours bar in VWAP/HOD/LOD. Use `< 16*60`. Minor skew.

## 🟡 LOW 5 — `fetchRecentFlows` 0DTE route uses DB date, not ET

**File:** `db.ts:618` — `WHEN expiry = CURRENT_DATE THEN '0dte'`. `CURRENT_DATE` is
the DB server's date (likely UTC). After ~20:00 ET the UTC date rolls to tomorrow,
so 0DTE classification can be off by a day near session end. Compare against the ET
market date instead.

---

## ✅ Checked & CLEARED
- **Flow dedup is solid** — `insertFlowAlert` uses `ON CONFLICT (alert_id) DO
  NOTHING RETURNING id`, returns true only on real insert (db.ts:674-689). No
  duplicate inflation. `alertId` builds a stable key (uw id, else composite).
- **Flow ordering consistent** — `fetchRecentFlows` ORDER BY created_at DESC
  matches the flow-streak newest-first assumption.
- **Ingest concurrency** — `ingestInFlight` single-flight + `INGEST_LOCK_MS`
  prevent cron/lazy stampede (flow-ingest.ts:77-94).
- **uw-rate-limiter** — audited in prior pass (Redis global + local token bucket).

---

## 🟠 MEDIUM 6 — Market breadth measures close-vs-OPEN, not close-vs-prior-close

**File:** `polygon.ts:176-177` (`computeMarketBreadthFromSummary`)
```
if (c > o) advancing++;        // close vs today's OPEN
else if (c < o) declining++;
```
**Bug:** Conventional advance/decline breadth compares **close vs prior close** (net
change on the day). This compares close vs **today's open** — i.e. intraday session
direction. A stock that gaps +5% on news and fades to close +2% (but below its open)
is counted **declining**, though it's clearly up on the day.

**How it fails:** On a gap-up-then-fade morning, "Market breadth: X% advancing"
(shown in the SPX recap and Night Hawk regime context) can read net-negative while
the tape is green vs yesterday — skewing the regime read that gates plays.

**Fix:** Use prior close. The grouped daily-summary endpoint lacks it, so either
(a) use snapshot `todaysChangePerc` (already vs prev close) for breadth, or
(b) diff against yesterday's grouped summary closes. At minimum, rename the metric
to "session % advancing" so it isn't presented as true A/D.

---

## 🟠 MEDIUM 7 — "new_highs" / "new_lows" are NOT 52-week highs

**File:** `polygon.ts:179-180`
```
if (h > 0 && c >= h * 0.998) newHighs++;   // "closed within 0.2% of TODAY'S high"
if (l > 0 && c <= l * 1.002) newLows++;
```
**Bug:** Fields named `new_highs`/`new_lows` (which imply the standard 52-week
new-highs breadth indicator) actually measure "closed near the **intraday** high/low."
Completely different signal.

**How it fails:** If the recap/Claude presents "142 new highs," it's wrong — it's
just "142 stocks closed strong today." Misleading breadth input.

**Fix:** Either compute true 52-week highs (needs historical range per ticker) or
rename to `closed_near_high` / `closed_near_low` so the semantics are honest.

---

## 🟡 LOW 8 — UW market-flow cache serves stale rows with no age cap on error

**File:** `unusual-whales.ts:380-384`
On any fetch error the cache fallback returns `marketFlowCache.rows` regardless of
age (the comment says "rate limited" but it catches all errors). If UW is down for
an extended period, last-good rows are served as current with no staleness signal to
the caller. Acceptable degradation, but consider an age cap / `stale: true` flag.
(Ingest path is unaffected — it uses `newer_than` and bypasses this cache.)

## Files read in full
spx-session.ts, flow-ingest.ts, flow-persist.ts (partial), db.ts flow functions,
ws/uw-socket.ts (status/staleness/halts sections).

## Pending (queue for a deeper pass)
- `unusual-whales.ts` (1430 lines) — only the market-flow fetch + cache path read;
  the other ~60 endpoints' parse/cache logic not line-read.
- `polygon.ts`, `polygon-largo.ts`, `polygon-options-gex.ts` — parsing/timezone.
- `gamma-desk.ts`, `spx-desk.ts`, `spx-commentary.ts`, `anthropic.ts`,
  `provider-policy.ts`, `macro-events.ts`, `gap-proxy.ts`, `web-search.ts`.
- ws/uw-socket.ts reconnect/auth-retry/backoff (lines 60-300) — skimmed, not audited.
