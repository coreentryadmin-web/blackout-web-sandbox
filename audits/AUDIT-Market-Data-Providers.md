# Batch 02 — Market Data Providers

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Plan:** `audits/AUDIT-PLAN.md` Batch 02  
> **Audited:** 2026-06-19 · **Step 2 + Step 3 complete**  
> **Scope:** 34 files (Polygon, Unusual Whales, WebSocket stores, flow ingest, GEX/gamma, rate limits, probes)  
> **Cross-check:** `complete-repo-bugs/AUDIT-Providers.md` (P1/P2/P6/P7)

---

## Coverage stats

| Metric | Value |
|--------|------:|
| Files in batch | 34 |
| Files read in full | 34 |
| Lines read (approx.) | ~8,900 |
| Probe scripts (dev-only) | 5 |
| Production lib modules | 29 |
| Dependencies traced | 100% of batch imports |
| Production findings | **3** (MEDIUM) |
| Low / degraded-mode notes (Step 3) | 5 |

### File inventory (all read)

| # | File | Role |
|---|------|------|
| 1 | `scripts/probe-polygon-ws.mjs` | Polygon WS auth probe |
| 2 | `scripts/probe-polygon.mjs` | Polygon REST probe matrix |
| 3 | `scripts/probe-uw-multiplex.mjs` | UW multiplex channel probe |
| 4 | `scripts/probe-uw-ws-auth.mjs` | UW REST + WS auth probe |
| 5 | `scripts/probe-uw-ws-urls.mjs` | UW WS URL variant probe |
| 6 | `src/lib/api-provider-catalog.ts` | Admin provider catalog |
| 7 | `src/lib/api-rate-quotas.ts` | Rate headroom display |
| 8 | `src/lib/flow-data-freshness.ts` | Flow age marker |
| 9 | `src/lib/flow-events.ts` | Redis flow fan-out |
| 10 | `src/lib/flow-persist.ts` | Flow DB + SSE publish |
| 11 | `src/lib/greek-exposure-summary.ts` | GEX expiry buckets |
| 12 | `src/lib/group-greek-flow-summary.ts` | Mag7 greek flow |
| 13 | `src/lib/live-api-integrations.ts` | UW WS/REST registry |
| 14 | `src/lib/market-internals.ts` | TICK/TRIN/ADD estimates |
| 15 | `src/lib/providers/config.ts` | Provider + cache TTL config |
| 16 | `src/lib/providers/flow-ingest.ts` | REST flow cron ingest |
| 17 | `src/lib/providers/gamma-desk.ts` | γ flip + GEX walls |
| 18 | `src/lib/providers/gap-proxy.ts` | SPY/SPX gap |
| 19 | `src/lib/providers/macro-events.ts` | Curated macro calendar |
| 20 | `src/lib/providers/polygon-largo.ts` | Extended Polygon for Largo |
| 21 | `src/lib/providers/polygon-options-gex.ts` | Polygon 0DTE GEX chain |
| 22 | `src/lib/providers/polygon.ts` | Core Polygon REST |
| 23 | `src/lib/providers/provider-policy.ts` | Polygon-first policy |
| 24 | `src/lib/providers/spx-commentary.ts` | Claude desk commentary |
| 25 | `src/lib/providers/spx-desk.ts` | SPX desk builder |
| 26 | `src/lib/providers/spx-session.ts` | ET dates + RTH stats |
| 27 | `src/lib/providers/spx-signal-log.ts` | Play signal dedup log |
| 28 | `src/lib/providers/unusual-whales.ts` | UW REST + WS normalizers |
| 29 | `src/lib/providers/uw-rate-limiter.ts` | UW token bucket |
| 30 | `src/lib/providers/web-search.ts` | Tavily/Serper/Brave fallback |
| 31 | `src/lib/vix-term-utils.ts` | VIX term structure |
| 32 | `src/lib/ws/init-data-sockets.ts` | One-shot socket init |
| 33 | `src/lib/ws/polygon-socket.ts` | Polygon index WS |
| 34 | `src/lib/ws/uw-socket.ts` | UW multiplex WS |

---

## Cross-check: `complete-repo-bugs/AUDIT-Providers.md` (P1/P2/P6/P7)

| ID | Prior finding | Current code | Verdict |
|----|---------------|--------------|---------|
| **P1** | Flow-ingest cursor mixed ISO + epoch (`start_time`) | Cursor uses **only** `raw.created_at`; comments forbid epoch mix-in | ✅ **FIXED** |
| **P2** | REST skipped on WS `OPEN` without staleness check | `isUwChannelFresh("flow_alerts", 120_000)` gates skip | ✅ **FIXED** |
| **P6** | Breadth compared close vs **open** (not prior close) | `fetchPriorDayCloses` + optional `priorCloseByTicker` in `computeMarketBreadthFromSummary` | ⚠️ **PARTIAL** — see Finding B2 |
| **P7** | `new_highs`/`new_lows` mislabeled as 52-week | Renamed `closed_near_high` / `closed_near_low`; type docs + consumers updated | ✅ **FIXED** |

### P1 — verified fixed

```62:69:src/lib/providers/flow-ingest.ts
    // Cursor must stay in UW's native `created_at` format and is echoed back as
    // `newer_than`. Never mix in `start_time` (epoch) — comparing epoch vs ISO
    // strings corrupts ordering and can drop or duplicate alerts. Rows without
    // `created_at` simply don't advance the cursor (still ingested + deduped).
    const created = String(raw.created_at ?? "");
    if (created && (!newestCursor || created > newestCursor)) {
      newestCursor = created;
```

### P2 — verified fixed

```25:31:src/lib/providers/flow-ingest.ts
  const wsStatus = uwSocket.getStatus();
  // Skip REST only if the WS is BOTH authenticated AND actually delivering data.
  if (wsStatus["flow_alerts"] === "OPEN" && isUwChannelFresh("flow_alerts", 120_000)) {
    return { ok: true, ingested: 0, polled: 0, skipped: "ws_active" };
  }
```

```553:556:src/lib/ws/uw-socket.ts
export function isUwChannelFresh(channel: UwWsChannel, maxAgeMs = 120_000): boolean {
  const at = lastMessageAt[channel];
  return at != null && Date.now() - at <= maxAgeMs;
}
```

### P6 — partial fix (library yes, SPX desk caller no)

Infrastructure is correct:

```212:217:src/lib/providers/polygon.ts
    // True advance/decline = close vs PRIOR close when available; fall back to
    // close-vs-open (session direction) only if no prior-close map was supplied.
    const prior = priorCloseByTicker?.[ticker];
    const ref = prior != null && prior > 0 ? prior : o;
    if (c > ref) advancing++;
    else if (c < ref) declining++;
```

Night Hawk path wires it correctly (`nighthawk/market-wide.ts:242-246`). **SPX desk does not** — Finding B2.

### P7 — verified fixed

```143:146:src/lib/providers/polygon.ts
  /** Count of stocks that CLOSED within 0.2% of their intraday high/low.
   *  NOTE: this is "closed strong/weak", NOT 52-week new highs/lows. */
  closed_near_high: number;
  closed_near_low: number;
```

```168:169:src/lib/providers/spx-commentary.ts
          closed_near_high: desk.market_breadth.closed_near_high,
          closed_near_low: desk.market_breadth.closed_near_low,
```

---

## Step 2 — Production findings

Severity: production user impact only. Probe scripts excluded (dev diagnostics).

### Finding counts

| Severity | Count |
|----------|------:|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 3 |
| LOW (Step 3 only) | 5 |

---

### B2-01 · MEDIUM — SPX desk breadth still uses session-direction A/D

**Files:** `src/lib/providers/spx-desk.ts:919-940`  
**Depends on:** `polygon.ts` (`fetchDailyMarketSummary`, `computeMarketBreadthFromSummary`) — prior-close helper exists but is **not called**.

```938:940:src/lib/providers/spx-desk.ts
  const marketBreadth = dailyMarket?.results?.length
    ? computeMarketBreadthFromSummary(dailyMarket.results)
    : null;
```

Without `priorCloseByTicker`, `computeMarketBreadthFromSummary` falls back to close vs **today's open** (`ref = o`). On gap-up-then-fade mornings, `pct_advancing` and A/D ratio shown on the SPX desk + fed to Claude commentary (`spx-commentary.ts:163-172`) skew net-negative vs true day change.

**Contrast (correct wiring):**

```242:246:src/lib/nighthawk/market-wide.ts
  const priorCloses = dailyMarket?.results?.length
    ? await fetchPriorDayCloses(today).catch(() => ({}))
    : {};
  const marketBreadth = dailyMarket?.results?.length
    ? computeMarketBreadthFromSummary(dailyMarket.results, priorCloses)
```

**Fix:** In `buildSpxDesk`, `await fetchPriorDayCloses(today)` and pass map into `computeMarketBreadthFromSummary`.  
**Test:** Mock grouped summary where many stocks gap up but close below open yet above prior close — desk `pct_advancing` should rise vs current behavior.

---

### B2-02 · MEDIUM — Trading-halt gate fails open when halts channel stale

**Files:** `src/lib/ws/uw-socket.ts:411-418`, consumers `src/lib/spx-play-gates.ts:88-92`, `src/lib/nighthawk/dossier.ts:266`  
**Prior ID:** P3 in `AUDIT-Providers.md` — **still open**.

```411:418:src/lib/ws/uw-socket.ts
export function hasActiveTradingHalt(symbols: readonly string[] = PLAY_HALT_WATCH_SYMBOLS): boolean {
  const watch = new Set(symbols.map((s) => s.toUpperCase()));
  for (const sym of Array.from(tradingHaltsStore.halts.keys())) {
    const halt = tradingHaltsStore.halts.get(sym);
    if (halt && watch.has(sym) && halt.active) return true;
  }
  return false;
}
```

`hasActiveTradingHalt` returns `false` when the map is empty — including when `trading_halts` never connected or went silent. `lastMessageAt.trading_halts` is tracked (line 527) but **never consulted** for gate decisions. Play engine and Night Hawk treat “no halt in store” as “safe to trade.”

**Fix:** If `!isUwChannelFresh("trading_halts", N)` during RTH, return unknown and block or require REST halt check for final tickers.  
**Test:** `authenticated=true`, empty `halts`, `lastMessageAt` 10 min old → play gates should not allow entry on unverified halt status.

---

### B2-03 · MEDIUM — `buildSpxDesk` bypasses Polygon index WebSocket merge

**Files:** `src/lib/providers/spx-desk.ts:777`, vs `buildSpxDeskPulse:1170`, `mergeWsIndexSnapshots:207-222`  
**Depends on:** `polygon-socket.ts` `indexStore`, `init-data-sockets.ts`.

Full desk fetch:

```777:777:src/lib/providers/spx-desk.ts
    fetchIndexSnapshots([SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]),
```

Pulse lane merges WS ticks when fresh (<5s):

```1170:1170:src/lib/providers/spx-desk.ts
  const snaps = mergeWsIndexSnapshots(snapsRaw);
```

Clients polling `/api/market/spx/desk` vs `/pulse` can see **different SPX prices and change_pct** during fast tape — commentary/play intel built from full desk lags the 1s pulse strip.

**Fix:** Call `ensureDataSockets()` + `mergeWsIndexSnapshots` in `buildSpxDesk` (same as pulse/flow lanes).  
**Test:** With Polygon WS feeding `indexStore`, desk price should match pulse within one REST poll.

---

## Step 2 — Cleared / solid (no production bug)

| Area | Evidence |
|------|----------|
| Flow dedup + publish | `flow-persist.ts` → `insertFlowAlert` ON CONFLICT; WS + REST share path |
| Ingest concurrency | `flow-ingest.ts` single-flight + `INGEST_LOCK_MS` |
| UW rate limiting | `uw-rate-limiter.ts` local bucket + optional Redis global RPS |
| WS freshness API | `getUwSocketHealth()` exposes `last_message_age_ms` per channel |
| GEX fallback chain | Polygon 0DTE → UW WS gex → UW REST spot exposures (`spx-desk.ts:796-806`) |
| Provider policy | Polygon-first for chains/indices; UW for flow exclusives (`provider-policy.ts`) |
| Signal dedup | `spx-signal-log.ts:29-30` session-scoped key (no score jitter dupes) |
| Probe scripts | Env-only, no production surface |

---

## Step 3 — Second pass (edge cases)

Additional production-adjacent risks; lower severity or degraded-mode only.

### S3-01 · LOW — RTH filter includes 16:00 bar

```83:83:src/lib/providers/spx-session.ts
    return mins >= 9 * 60 + 30 && mins <= 16 * 60;
```

16:00 ET bar is the 16:00–16:01 minute (post cash close). Minor VWAP/HOD/LOD skew. Use `< 16 * 60`.

### S3-02 · LOW — UW market-flow cache serves unbounded stale on error

```380:387:src/lib/providers/unusual-whales.ts
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (marketFlowCache) {
      console.warn("[uw] flow-alerts rate limited — serving cache:", message);
      return filterMarketFlowRows(marketFlowCache.rows, params);
```

Any fetch failure (not just 429) returns cache with no max age or `stale` flag. Ingest path uses `newer_than` and bypasses this cache — desk/tape polling can show ancient flow during extended UW outage.

### S3-03 · LOW — `fetchUpcomingMacroEvents` drops 2027 schedule

```188:188:src/lib/providers/macro-events.ts
  return US_MACRO_SCHEDULE_2026.filter((e) => e.date >= today && e.date <= end).map((e) => ({
```

`ALL_MACRO_SCHEDULE` includes 2027 rows for “today” lookups, but upcoming-events helper only scans `_2026`. Breaks Largo `get_economic_calendar` after 2026-12-31.

### S3-04 · LOW — `greek-exposure-summary` default “today” is UTC

```31:31:src/lib/greek-exposure-summary.ts
  const today = todayYmd ?? new Date().toISOString().slice(0, 10);
```

Callers pass ET `todayEtYmd()` from desk — safe on main path. Direct calls without `todayYmd` mislabel 0DTE bucket near ET midnight.

### S3-05 · LOW — Flow cursor non-advance when UW omits `created_at`

Rows with only `start_time` are parsed to ISO in `parseUwFlowAlert` but cursor ignores them (P1 fix). Dedup prevents duplicates; cron may re-fetch overlapping pages (extra UW quota burn, not data loss).

### Edge-case matrix (second pass)

| Scenario | Behavior | Risk |
|----------|----------|------|
| UW WS auth fail | 5 min backoff, `AUTH_FAILED` status | REST fallbacks activate for flow ingest (P2 fixed) |
| Silent WS (OPEN, no msgs) | REST ingest resumes after 120s | ✅ mitigated |
| Polygon WS down | Pulse merges only if `indexStore` fresh 5s | Falls back to REST snapshots |
| No `DATABASE_URL` | Flow ingest skipped; SSE still works | Expected |
| No `REDIS_URL` | No cross-instance sticky/tape; in-process sticky only | Multi-instance desk GEX/tape divergence |
| Holiday / closed | `buildSpxDeskFlow` / pulse guard on `isSpxRthActive` | Full desk still builds if Polygon configured |
| UW 429 storm | `uwGetSafe` exponential backoff; throttle bucket | Degraded nulls, cache fallback |
| Half-open TCP UW | Channel stays OPEN until close event | Freshness gate limits blast radius |

---

## Dependency graph (batch-internal)

```
init-data-sockets
  ├── polygon-socket → indexStore → spx-desk (pulse/flow merge only)
  └── uw-socket → stores (tide, gex, dark pool, net_flow, halts)
        └── flow-persist → flow-events → Redis pub/sub

flow-ingest → unusual-whales.fetchMarketFlowAlertRows
            → flow-persist → db (batch 06)

spx-desk → polygon (indices, bars, breadth, news)
         → polygon-options-gex (0DTE GEX primary)
         → unusual-whales (flow, tide, dark pool, macro)
         → gamma-desk, gap-proxy, macro-events, greek summaries
         → ws/uw-socket stores (with staleness TTLs)

spx-commentary → spx-desk payload → anthropic (batch 05 file, not in batch)
```

**External batch consumers (integration only):** `spx-play-gates.ts`, `nighthawk/*`, `largo/run-tool.ts`, `db.ts` flow functions, API routes batch 03.

---

## Summary

| | |
|--|--|
| **Batch status** | ✅ Step 2 + Step 3 complete |
| **Files read** | 34 / 34 (100%) |
| **Production findings** | 3 MEDIUM |
| **P1/P2/P7** | Fixed in current code |
| **P6** | Partial — fix landed in `polygon.ts`; **SPX desk caller still omits prior closes** |
| **P3 (halt fail-open)** | Still open |

**Recommended fix order:** B2-01 (breadth) → B2-02 (halt gate) → B2-03 (desk WS merge).
