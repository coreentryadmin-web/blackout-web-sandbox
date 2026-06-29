# BlackOut — North Star & Engineering End-Goals

> **What this is:** the *why* behind every change. The audit docs tell you "is the code correct";
> this tells you "correct toward **what**." When you (engineer or AI) make any decision — a fix, a
> feature, a refactor, a trade-off — optimize toward these goals, in this priority order. When two
> goals conflict, the higher one wins.
>
> Read alongside `docs/ONBOARDING.md` (how the system works) and `.cursor/rules/architecture.mdc`
> (the hard rules). This file is the standing definition of "good."

---

## The mission

BlackOut gives serious options traders **institutional-grade intelligence they can act on with
confidence** — live positioning, flow, and AI analysis, delivered fast, correct, and always on.
Users **risk real money on what we show them.** That single fact sets the entire bar below.

## The prime directive (overrides everything)

**Every number a user sees is real, live, and provably correct — or it isn't shown.**
There is no acceptable "close enough." A wrong price, level, wall, or stat isn't a cosmetic bug — it
can put a user into a losing trade. We would rather show an honest "data unavailable" than a
plausible-looking wrong number. Trust is the product; one fabricated value breaks it permanently.

---

## The end-goals (priority order)

### 1. Truth — every value is grounded
- **Goal:** 100% of user-visible numbers trace to live source data, auto-update, and match the
  source of truth. Zero hardcoded, mocked, defaulted, fabricated, or hallucinated values anywhere a
  user can see.
- **Good looks like:** every figure is sourced from a cache-reader backed by a live writer; staleness
  is shown honestly (`FreshnessChip`), never disguised as fresh; the data-correctness auditor
  (`lib/correctness/`, `api/cron/data-correctness`) passes with 0 unexplained discrepancies; the same
  figure is identical across every tool that shows it (desk wall == GEX endpoint wall).
- **Never:** a hardcoded fallback that renders as if real; a stale value with no freshness signal; two
  tools disagreeing on the same number.
- **Measure:** 0 fabricated values · 0 cross-tool numeric mismatches · data-correctness green.

### 2. Always on — reliability & graceful failure
- **Goal:** the platform is up and trustworthy 24/7, and degrades *honestly* when a dependency fails.
- **Good looks like:** a provider/Redis/DB outage produces a clear empty/stale state, not a crash, a
  blank screen, or — worst — a wrong number. Money/data paths **fail closed**; read paths fail open
  to an honest empty state. No unhandled rejection can take down a replica (see the `db.ts`/
  `make-redis.ts` error handlers — invariant).
- **Never:** a single slow query, dead socket, or missing env var cascades into an outage; a guard
  that fails *open* on a write/auth path.
- **Measure:** uptime ≥ 99.9% · 0 replica crashes from unhandled errors · every external call has a
  defined failure mode.

### 3. Never hit rate limits — scaling discipline
- **Goal:** we never throttle, get throttled, or red-line a data provider, no matter how many users
  or replicas are live.
- **Good looks like:** per-user/per-request endpoints **read the shared cache**; exactly **one**
  WebSocket per provider key (Redis leader election); cron/WS writers warm the cache, everyone else
  reads it. The flow provider's ~2 req/s cluster-wide budget is never exceeded; adding users adds
  *zero* upstream calls.
- **Never:** a new feature that calls a provider directly per request; a second parallel path to data
  that already has a cache-reader (e.g. GEX is single-sourced via `getGexPositioning()`).
- **Measure:** 0 provider 429s · upstream call volume flat as users grow · 1 WS per key.

### 4. No leaks — security & entitlements
- **Goal:** paid data reaches only paying users; private data reaches only its owner; nothing is
  exploitable.
- **Good looks like:** every route returning paid or per-user data enforces auth **and** tier
  (`require*Api` / middleware); webhooks verify signatures; cron-write routes fail **closed** without
  the secret; no IDOR, injection, or SSRF. Unauth → 401 on protected routes is correct behavior.
- **Never:** a route that returns paid/per-user data without a gate (this class already bit us —
  `/api/signals/open` was once unauthenticated); a guard shaped `if (secret && ...)` that passes when
  the secret is unset.
- **Measure:** 0 unauthenticated paid-data routes · 0 missing webhook signature checks · 0 fail-open
  write guards.

### 5. Correct trades — trading-logic integrity
- **Goal:** the logic that produces levels, scores, entries, stops, and outcomes is mathematically and
  directionally correct.
- **Good looks like:** confluence scoring, level math, option-ticket build, and P&L/outcome recording
  are unit-tested on the money paths; entries only open when the documented gates truly pass; the SPX
  desk veto stays opt-in (`SPX_OPTION_CHAIN_REQUIRED` false in prod) so approved plays actually open.
- **Never:** a sign/off-by-one error in a level or P&L; a play that opens on the wrong side or with a
  wrong stop; outcomes that don't reconcile (wins+losses+scratch == closed).
- **Measure:** money-path logic has tests · outcome partitions reconcile · 0 directional errors.

### 6. Fast — real-time feel
- **Goal:** the product feels instant and live, because traders act in seconds.
- **Good looks like:** reader endpoints are cache-fast (no per-request provider/DB round-trips on hot
  paths); no N+1 queries; queries are indexed; the bundle is lean; marketing pages are edge-cached.
- **Never:** blocking provider calls inside a request handler on a hot path; an unindexed scan on a
  per-request query.
- **Measure:** reader p95 well under a second · 0 N+1 on hot paths · edge cache hit on static pages.

### 7. Institutional feel — the UX bar
- **Goal:** the product looks and feels like a professional trading terminal, earning trust on sight.
- **Good looks like:** Bloomberg density, TradingView quote clarity, Stripe trust, Linear restraint;
  JetBrains Mono for numbers; `FreshnessChip` for live state; honest, plain copy. See
  `DESIGN_BENCHMARK.md`.
- **Never:** grey text on `#040407` (banned), fake LIVE badges, text-glow on prices, scanlines,
  military/hype copy, emoji padlocks, Discord-cosplay aesthetics.
- **Measure:** 0 banned-grey usages · 0 fake-live indicators · brand lint (`npm run lint:brand`) green.

### 8. Confidential edge — protect how it's built
- **Goal:** competitors and users learn *what* we do, never *how*.
- **Good looks like:** no public surface (marketing, in-app copy, API responses, metadata, errors)
  names a provider, database, host, AI vendor, or auth/billing vendor.
- **Never:** a vendor name, internal stack detail, or revealing error leaking to a public response.
- **Measure:** 0 stack-disclosure leaks on public surfaces.

### 9. Maintainable — one source of truth
- **Goal:** the codebase stays understandable and changeable as it grows.
- **Good looks like:** one canonical implementation per concept (no divergent copies); strong types
  (minimal `any`/`as`); no dead code (unmounted components, zero-writer tables, unused routes); docs
  in `docs/` reflect reality; `tsc --noEmit` is 0 errors.
- **Never:** a second copy of logic that drifts; a table/route/component nobody uses left to rot; a
  doc that teaches a stale fact.
- **Measure:** tsc 0 errors · 0 known dead tables/routes · single source per concept.

### 10. Observable — we find problems before users do
- **Goal:** every failure is detectable and attributable from telemetry, not from a user complaint.
- **Good looks like:** errors land in the sink; provider calls are tracked; cron/feed staleness is
  watched (`cron-staleness-watchdog`, `feed-staleness`); the auto-auditor surfaces regressions every
  4h into `OPEN-ISSUES.md`.
- **Never:** a silent failure; a degraded feature with no signal; a cron that "exists" but isn't
  actually running and nobody notices.
- **Measure:** every outage class has a detector · 0 silent-failure paths on money/data.

### 11. Cost-disciplined — efficient by design
- **Goal:** AI and provider spend scale sub-linearly with usage and never run away.
- **Good looks like:** the cross-replica AI spend ledger holds; caching avoids redundant provider/AI
  calls; the kill-switch is available if needed.
- **Never:** an uncapped per-user AI loop; redundant provider calls a cache could serve.
- **Measure:** spend flat-to-sublinear vs usage · 0 runaway AI loops.

### 12. Honest by default — trust as a feature
- **Goal:** when we don't know, we say so. Confidence shown must equal confidence held.
- **Good looks like:** "unavailable" / "resumes at the open" / "confirmed vs consistency" honesty in
  the data-correctness model and in every empty state.
- **Never:** dressing uncertainty as certainty; a confident UI over unverified data.

---

## The decision rule (when goals conflict)

**Truth > Reliability > Security > Correctness of logic > everything else.**
Concretely:
- Never ship a number you can't ground — even to hit a deadline or fill a panel.
- On money/data/write/auth paths, when in doubt, **fail closed**.
- Prefer reading the existing cache-reader over any new provider call, always.
- Prefer an honest empty state over a plausible guess.
- Correctness and trust beat shipping speed. A wrong number costs more than a late feature.

## Definition of done (every change must clear this)

A change is not "done" until:
1. Every value it introduces is live-sourced and grounded (no fabrication, freshness shown).
2. It adds **zero** new per-request upstream calls (reads the cache).
3. Any new data route is auth + tier gated; any write/cron route fails closed without its secret.
4. It doesn't violate the don't-break list (`db.ts`/`make-redis.ts` handlers, real shell,
   `SPX_OPTION_CHAIN_REQUIRED` false, UW_API_KEY, nested route paths).
5. No public surface leaks the stack; no banned-grey; `FreshnessChip` where live.
6. `tsc --noEmit` 0 errors; relevant tests + `lint:brand` pass.
7. Failure modes are defined (what the user sees when a dependency is down).

---

*Keep adding. As the product and its risks evolve, extend these goals — but never lower the prime
directive: every number real, live, and correct, or not shown.*
