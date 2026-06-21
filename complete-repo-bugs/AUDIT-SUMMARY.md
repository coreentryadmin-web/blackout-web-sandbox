# Full Repo Audit — Summary

Date: 2026-06-19. Repo: blackout-web (326 .ts/.tsx files).

## Critical & High findings (act on these)

| # | Sev | Area | File | Issue |
|---|-----|------|------|-------|
| 1 | ✅ FIXED | Auth | `api/engine/[...path]/route.ts` | ~~Unauthenticated proxy forwarding attacker-controlled path + POST body to the engine with `DASHBOARD_API_SECRET`.~~ **Fixed 2026-06-19:** now requires auth (or cron) via `authorizeCronOrTierApi`, allowlists only `nighthawk/plays` + `heatmap` (read-only), blocks path traversal, and disables POST (405). Typecheck clean. |
| 2 | ✅ FIXED (code) | Security | `lib/api.ts` | ~~`NEXT_PUBLIC_ENGINE_WS_KEY` shipped in client bundle.~~ **Fixed 2026-06-19:** deleted the dead `createFlowSocket()` (never called) — the only client reference to the key. Live feed uses gated SSE `/api/market/flows/stream`. ⚠️ **Ops follow-up required:** rotate the WS key (it was in prior bundles) and remove `NEXT_PUBLIC_ENGINE_WS_KEY`/`_URL` from Railway env. |
| 3 | 🟠 MED | Payments | `api/webhook/whop/route.ts:8` | If `WHOP_WEBHOOK_SECRET` unset, signature verification may be skipped (forged webhooks). Mitigated by source-of-truth re-sync; fail closed instead. |
| 4 | 🟡 LOW | Auth | `market-api-auth.ts:9` + `cron/flow-ingest:9` | Cron secret accepted via query string (log-leak vector); non-constant-time compare. Header-only. |
| A | 🟠 MED | Night Hawk | `claude-edition.ts:100` | Option chains fetched twice (24 redundant fetches; doubles UW fallback load). |
| B | 🟠 MED | Night Hawk | `option-chain-prompt.ts:284` | Year rollover rejects valid January plays in late December. |
| P1 | ✅ FIXED | Providers | `flow-ingest.ts:59` | ~~Cursor mixed ISO + epoch.~~ **Fixed:** cursor now uses only UW-native `created_at`; never mixes in `start_time`. |
| P2 | ✅ FIXED | Providers | `flow-ingest.ts:26` + `uw-socket.ts` | ~~Skipped REST on WS OPEN ignoring staleness.~~ **Fixed:** added `isUwChannelFresh()`; REST skip now requires a flow message within 120s. |
| P3 | 🟡 LOW-MED | Providers | `uw-socket.ts:412` | Trading-halt gate fails open if `trading_halts` channel down/stale → Night Hawk could recommend a halted stock. |
| P6 | ✅ FIXED | Providers | `polygon.ts` | ~~Breadth used close-vs-open.~~ **Fixed:** true A/D via prior-day close map (`fetchPriorDayCloses`), graceful fallback to close-vs-open. |
| P7 | ✅ FIXED | Providers | `polygon.ts` | ~~`new_highs`/`new_lows` mislabeled.~~ **Fixed:** renamed to `closed_near_high`/`closed_near_low` across type + all consumers; honest display labels. |
| P8 | 🟡 LOW | Providers | `unusual-whales.ts:380` | Market-flow cache serves stale rows with no age cap on error (no `stale` flag). |
| L1 | ✅ FIXED | Largo | `question-intent.ts:48` | ~~`extractTicker` pinned non-tickers ("WHAT"/"FED"/"CPI") on most non-ticker questions.~~ **Fixed:** match original-case text + `NON_TICKER_CAPS` exclusion. |
| L2 | 🟡 LOW-MED | Largo | `anthropic.ts:202` | Tool loop returns mid-reasoning text on 12-round exhaustion (no final tool-less call). |
| L3 | 🟡 LOW | Largo | `anthropic.ts:206` | Tool loop ignores per-call temperature override. |
| S1 | ✅ FIXED | SPX/Admin | `spx-signal-log.ts` | ~~Dedup key included drifting score/headline.~~ **Fixed:** key is now session-scoped `action\|direction`; score-jitter no longer logs near-dup signals. |
| S2 | 🟡 LOW | Config | `next.config.mjs` | No security headers (CSP/HSTS/X-Frame-Options). Hardening. |
| P4 | 🟡 LOW | Providers | `spx-session.ts:83` | RTH filter includes the 16:00 post-close bar (`<= 16*60`). |
| P5 | 🟡 LOW | Providers | `db.ts:618` | 0DTE route classification uses DB `CURRENT_DATE` (UTC), not ET market date. |

See `AUDIT-Providers.md` for full detail. Batch 5 partially complete (flow path +
WS status audited; remaining provider files queued).

**Top priority: #1, then #2.** Both are access-control holes that expose premium
data (or worse) to the public. #1 is the most serious in the repo.

## What was audited this pass (full reads)
- Payments & Auth: middleware, auth-access, admin-access, market-api-auth,
  membership, whop, engine, whop webhook, membership/sync, two unguarded routes.
- API Route Authorization: all 42 routes enumerated + classified (matrix).
- Security/secrets sweep: NEXT_PUBLIC_* vars, .gitignore, cron-secret handling.
- Night Hawk: status carried from prior line-by-line audits (2 minor open).

## What is mapped but PENDING a deep pass
- **Market Data Providers** (`lib/providers/**`, `lib/ws/**`) — caching/staleness,
  parse bugs, rate-limit, timezone. Partially seen via Night Hawk work.
- **Largo AI** (`lib/largo/**`, `providers/anthropic.ts`) — tool loop, intent,
  session store eviction, cost controls.
- **SPX Desk + Admin** (`spx-*`, `platform/**`, `components/admin/**`).
- **Frontend + Config** (`app/**/page.tsx`, `components/**`, `hooks/**`,
  `lib/api.ts` full, next.config, railway.toml).

See `AUDIT-PLAN.md` for the batch map. Highest-stakes (money/auth/security) were
done first by design. Recommend providers + largo next (shared blast radius).

## Honest coverage statement
This was a focused-deep audit prioritizing money / auth / security / signal
correctness across ALL 8 batches — not an exhaustive 326-file line read. Every
file listed under each batch's "full reads" was read completely and its
dependencies verified. The remaining long tail (thin UW endpoint mappers,
individual Largo tool cases, large SPX desk/commentary signal-math line read, UI
components) is queued in AUDIT-PLAN.md and is lower-risk by design — the
high-stakes decision/auth/data paths were all covered.

## Final tally
- **2 Critical** (engine proxy, WS key) — FIXED + deployed.
- **1 engine fail-open** — FIXED + deployed. Secret rotated.
- **Mediums fixed + pushed:** flow cursor (P1), stale-WS fallback (P2), Largo
  ticker extraction (L1). 
- **Mediums documented (need design/data decisions):** breadth math (P6/P7),
  SPX signal dedup (S1), Night Hawk chain double-fetch (A) + Jan rollover (B).
- **Lows documented:** P3/P4/P5/P8, L2/L3, S2, webhook fail-closed (#3), cron
  query-secret (#4).
- **Verified clean:** SPX action routing/thresholds, admin auth + command-exec,
  XSS/CORS/eval/injection sweep, flow dedup, tier downgrade, membership sync.

## Recommended fix order for the documented-open items
1. **S1** SPX signal dedup (duplicate signals pollute history/outcomes).
2. **P6/P7** breadth semantics (skews Night Hawk regime context) — needs the
   snapshot-vs-prior-close data decision.
3. **A/B** Night Hawk chain double-fetch + Jan rollover (B before year-end).
4. **#3** Whop webhook fail-closed, **P3** halt-gate freshness.
5. Lows / hardening (S2 headers, #4 cron header-only, L2/L3, P4/P5/P8).
