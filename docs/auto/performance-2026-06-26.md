# Performance Audit — 2026-06-26 (Fri, ~03:30 PT)

First run of the weekly `performance-audit` job → establishes the baseline. Market CLOSED at audit time (after-hours), so live-poll lanes were idle; cold-path measurements still valid. Repo: `blackout-cron` (isolated clone). tsc + `next build` both green pre- and post-change.

## Method
- Core Web Vitals / timings via the Chrome bridge against production `https://blackouttrades.com` (browser already authed → measured `/dashboard`, `/heatmap` too).
- Per-route bundle sizes from `next build`. CSS/JS raw vs gzipped measured locally.
- Backend: read the desk/auth/cache hot paths + grepped for sequential-await N+1s.

## Metrics (baseline)

### Page timings (production, warm CDN)
| Page | TTFB | DCL | load | Notes |
|---|---|---|---|---|
| `/` (home, public) | 233ms | 436ms | 810ms | ✅ healthy |
| `/dashboard` (authed) | 296ms | 423ms | 784ms | doc fast; **desk XHR 5.1s** ⚠️ |
| `/heatmap` (authed) | 196ms | — | — | no after-hours polling (expected) |

### Compression — ✅ confirmed (was a candidate false-positive)
`PerformanceResourceTiming.encodedBodySize` reported the CSS at 411KB which looked uncompressed, but direct header checks show production **is** compressing:
- CSS/JS: `Content-Encoding: gzip` (main CSS 421KB raw → **60KB gz** on wire; biggest JS chunk 170KB gz).
- HTML: `Content-Encoding: br` (Cloudflare in front). No action needed.

### Per-route First Load JS (from build) — all reasonable
| Route | First Load | Route chunk |
|---|---|---|
| `/dashboard` | **223 kB** | 19.1 kB | (heaviest)
| `/admin` | 187 kB | 34.3 kB |
| `/sign-in`,`/sign-up` | 193 kB | 142 B | (Clerk)
| `/nighthawk` | 180 kB | 15.8 kB |
| `/heatmap` | 179 kB | 20.8 kB |
| `/flows` | 176 kB | 23.8 kB |
| `/` | 170 kB | 18.2 kB |
| `/terminal` | 161 kB | 6.4 kB |
| `/upgrade` | 148 kB | 1.1 kB |
- Shared chunk: **102 kB** (1255 = 46kB, 4bd1b696 = 54kB). Middleware 96.3 kB.
- `framer-motion` (^11) + `recharts` (^2) are the heavy deps. recharts is already code-split out (DarkPoolSpark/FlowMomentumChart/FlowVolumeChart only). framer-motion is used by Nav (global) + all landing sections → sits in shared; needed for the marketing animations, not worth a risky removal now.
- Largest client component: `GexHeatmap.tsx` (3958 lines) — but it's already isolated to the `/heatmap` route chunk (+20.8kB), not in shared. Fine.

### Backend hot paths — ✅ well-architected
- Auth/tier: `resolveUserTier` is in-memory cache-first reading Clerk publicMetadata (cheap); Whop membership sync is webhook/cron-only, NOT on page load.
- Desk: `withServerCache` has in-flight dedup + SWR + Redis layer.
- No N+1 on the page-load path; `fetchSpxDeskFlowAlertsWithDb` already has a 10s in-flight dedup; UW calls go through the 2-RPS rate limiter (`runUwSequential`).

## ⚠️ Key finding — `/api/market/spx/desk` ~5.1s cold/stale blocking rebuild
`deskCacheTtlMs` default = **10s** AND the route sets `staleWhileRevalidate:false` (freshness-honesty, ISSUE-29). So every cache miss/expiry does a BLOCKING `buildSpxDesk`, whose dominant cost is ~13 UW calls serialized through the 2-RPS cluster-wide limiter (two `runUwSequential` blocks of 6 + flow-alerts). With SWR off + a 10s TTL, in-flight dedup makes all concurrent desk viewers wait for the rebuild ~once per 10s window during RTH — not just on cold start.

## ✅ Fixed → main (`22378ae`, safe, build-gated)
Two behavior-preserving concurrency wins (identical results, just parallel; a throw still aborts the build exactly as before):
1. **`buildSpxDesk`** — `mergeMacroEventsToday` + `resolveDeskGap` + the `[dailyMarket, priorCloses]` pair were three sequential awaits on the blocking-rebuild path → one `Promise.all` (max(t) not sum(t)). Sync breadth/internals derivations kept inline.
2. **`buildSpxDeskFlow`** — Polygon index snapshot and UW flow-alerts (independent providers) were sequential on the ~4s live flow lane → now concurrent.

These trim the non-UW critical path; they do **not** remove the UW-bound floor (architectural).

## 🚩 Flagged for human review (design/freshness call → Task #1)
**Eliminate the ~5s blocking desk rebuild.** Preferred: a desk-warm cron/interval calling `buildSpxDesk` every ~8s during RTH (mirror `railway.heatmap-warm` / `railway.nights-watch-warm`) so user polls always hit warm cache. Alt: enable SWR with a tight max-stale-age — the payload already carries age stamps (`gex_age_ms`, `price_age_ms`, `flow_data_age_ms`) and the live price comes from the separate 1s pulse lane, so brief full-desk staleness is lower-risk than it looks. Verify post-change via the RTH market-hours-audit: desk XHR p95 5s → <200ms.

## Notes / no-action
- Main CSS 421KB raw (60KB gz wire) — Tailwind-generated, gzips fine; not worth a risky purge change.
- Could not measure RTH live-poll lanes (`spx/pulse`, `spx/flow`, gex-heatmap polling) — market closed. Re-measure during the next RTH window; pulse lane TTL=1s/structure=5s already looks well-tuned in code.

## Trend
| Date | Home load | Dashboard desk XHR | Heaviest First Load | Fixes→main | Flags |
|---|---|---|---|---|---|
| 2026-06-26 | 810ms | 5.1s (cold) | 223 kB (/dashboard) | 2 (parallelize) | 1 (desk warm/SWR) |

_Baseline established. Next run: confirm the parallelize fix held, re-measure desk XHR during RTH, and check whether Task #1 landed._
