# error-triage — 2026-06-25 (NIGHT run, 10:13 PM PT slot)

Autonomous daily production error triage (SDLC §3). **Third run today** — checks the durable error
sink, incidents, admin health, and provider telemetry on the LIVE app for NEW/spiking error
signatures **since the prior run (~13:42 PT)**, then runs a focused multi-agent deep-pass over the
NET-NEW code the prior two passes never saw + the surface raised by today's one live signal. FIX
high-confidence small/isolated/build-gated bugs → `main`; branch + flag the rest.

Prior logs: `error-triage-2026-06-25.md` (12:45 PT) · `error-triage-2026-06-25-pm.md` (13:42 PT).

## Run @ 2026-06-25 ~14:48 PT (autonomous; third error-triage run)

Repo: `C:/Users/raidu/blackout-cron` (isolated cron clone). Market **CLOSED** (after RTH).
`main` @ `7e5989c`, tsc-green (exit 0). Net-new feature commits since the prior triage (`4a055d4`):
- `71d0be3` feat(anthropic): opt-in + auto system-prompt caching in `anthropicText` (C-4)
- `64d92a2` fix(seo): per-page browser titles (6-line `metadata` exports per tool page)
- `fdeff7f` Heatmaps UI: one compact control row, wider Matrix (`GexHeatmap.tsx` +397/−159)

---

### A. LIVE production triage (via Chrome bridge, logged-in admin session)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `{"ok":true,"events":[]}` — **0 durable error events** |
| Open incidents | `/api/admin/incidents` | ✅ `incidents:[]` — none open |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`, `critical:0 / warning:0 / info:0`, `issues:[]`, `route_errors:[]`, `redis_degraded:false`, `market_health_ok:true` |
| Provider telemetry | health snapshot | polygon 705 / **0 err**; UW 35 / **0 err**; **anthropic 1 / 1 err** (see below); circuits closed, 0×429; rate-limiter tokens healthy |
| WS health | health snapshot | ✅ polygon-indices OPEN+auth; all 5 UW channels OPEN+auth, `auth_failed_channels:[]`; Massive options WS OPEN+auth (3 contracts) |
| API dashboard | `/api/admin/apis/dashboard?window_min=600` | **errors_window:1 over 800 calls / 10h** (error_rate 0.125%), `active_retries:[]` |

**One NEW signal since the prior run — a single transient Anthropic timeout (gracefully handled, NOT a regression):**

```
provider: anthropic · endpoint: anthropic-text · status: null · ok: false
latency_ms: 82851 · error: "Request timed out." · attempt 4/4 · retry_status: exhausted
at: 2026-06-25T21:46:59.949Z · severity: p1 · sla_breach: false · synthetic: false
```

ROOT CAUSE: the Anthropic SDK client is configured `timeout: 20_000` + `maxRetries: 3` (`getClient`,
`anthropic.ts:206`), i.e. up to **4 attempts × 20s = ~80s** — the observed 82.8s is 4 sequential
per-attempt 20s timeouts, the upstream `api.anthropic.com/v1/messages` not responding in time, four
times in a row. **Single event** — exactly ONE error in the last 10 hours (600m window), 0 incidents,
NOT spiking; `error_rate` 0.125%.

**Gracefully handled — no unhandled 500.** `anthropicText` wraps the call in `try { … } catch { return
null; }` (`anthropic.ts:380-391`), so the timeout surfaces as a `null` return, not a thrown 500. The
durable error sink stayed empty (the timeout is provider telemetry, not a persisted app error).
`health_ok` remained `true` (not raised to critical). **→ no fix: transient upstream slowness, correctly
caught.** The 20s×4 budget is a known reliability/latency tradeoff (per-call `timeoutMs`/`maxRetries`
overrides exist) owned by `performance-audit` / `api-integration-audit`, not error-triage.

> Follow-through (the real error-triage question this raised): since the timeout returned **null**, do
> ALL `anthropicText` callers survive a null return? Verified in the deep-pass below (finder
> `anthropic-null-handling`, 8 call sites) → **0 callers crash on null.**

**Not regression-linked to the net-new caching commit.** `71d0be3` is purely additive system-block
shaping (`applySystemCache` wraps a ≥16K-char or opt-in system as one `cache_control:ephemeral`
block; default path byte-identical) — it cannot make a request slower or time out. Manually reviewed
the full diff: defensive (`text.trim()` empty-guard, `b.text?.length ?? 0`, respects caller-placed
breakpoints, conservative haiku 4,096-tok auto-detect floor). tsc-green.

---

### B. Deep-pass — latent runtime-error audit (focused on the net-new delta + the live-signal surface)

Manual review of the **entire net-new delta** first (it's small): `anthropic.ts` caching (additive,
clean, above); `GexHeatmap.tsx` `fdeff7f` (a tsc-green UI layout refactor — new searchable ticker
combobox + lifted `pairView` state; combobox guards verified: `options[active] ?? options[0]`,
`Math.min(i+1, Math.max(0, options.length-1))`, and `r.ticker.toUpperCase()` is safe because
`fetchPolygonTickerSearch` maps `ticker: String(r.ticker ?? "")` so it's always a string); `Heatmap.tsx`
(trivial sub-bar removal); page `metadata` exports (trivial). The lens→`pairView` no-reset is an
intentional, graceful behavior change (Shift half self-explains under DEX/CHARM), not a throw.

Workflow `error-triage-deep-pass-3`: 5 disjoint finders → adversarial verify of every medium/high
"throws at runtime" finding, each cross-referencing both prior logs to suppress the 5 already-fixed +
2 flagged items. **6 agents, ~457k subagent tokens, 554s.**

| Finder | Scope | Raw | Verified |
|---|---|---|---|
| anthropic-null-handling | all 8 `anthropicText` call sites survive a null return (today's exact failure mode) | 0 | 0 |
| gexheatmap-netnew | `fdeff7f` combobox `options`/keyboard handler + `pairView` lift | 0 | 0 |
| cron-resilience | cron handlers' AI+DB awaits → transient-into-500 (disjoint from the 3 AM fixes) | 0 | 0 |
| parse-coerce | `JSON.parse`/`Number`/`Date`/`.toFixed`/`.split` on possibly-undefined in hot + touched paths | 1 | **0 (discarded)** |
| provider-error-shape | polygon/UW/massive client error/timeout propagation to unguarded callers | 0 | 0 |

**1 raw candidate → adversarially verified `discard` (low):** `src/lib/api.ts:537` — `JSON.parse(payload)`
in the **client-side** Largo SSE stream reader. Discard is correct, independently confirmed:
- Pre-existing (NOT in today's net-new delta); no production signature (durable sink empty, 0 client errors).
- Client-side, consuming **our own** well-formed SSE endpoint; `payload` is already guarded
  (`!startsWith("data:")` skip, empty-payload skip).
- The enclosing `streamLargoChat` **already `throw`s by design** on an `error`-type frame
  (`api.ts:557`) and on "stream ended without result" (`api.ts:562`), so a malformed-frame parse
  throw lands in the **caller's existing stream-error rejection path** — not a new crash surface.

**Result: 5 finders, 1 raw candidate, 0 confirmed.** Net-new heatmap/caching/metadata delta is
runtime-clean; every `anthropicText` caller survives the null return that fired in production today.

---

### Result

**✅ PRODUCTION ERROR SURFACE CLEAN — 1 transient (handled) signal, 0 incidents, 0 latent bugs. No fixes, no flags this run.**

- **Live:** durable sink empty · 0 incidents · `health_ok:true` (all counts 0) · `route_errors:[]` ·
  **1 error in 10h** = a single 4×20s Anthropic upstream timeout, caught → `null`, not spiking, not a
  regression. WS/circuits/rate-limiters all healthy.
- **Delta:** the 3 net-new feature commits (anthropic caching · heatmap control-row refactor · page
  titles) are defensive + tsc-green; the focused 5-finder deep-pass found no runtime-throw risk.
- **Null blast-radius (the one thing today's signal actually demanded):** all 8 `anthropicText`
  callers verified to survive a `null` return → no caller crashes on the exact failure that fired.

### Carry-forward
- Durable error sink persists across runs — re-check next run. Still empty.
- The 2 items on branch `auto/error-triage-2026-06-25` (db-cleanup `allSettled`, options-socket map
  eviction) remain open for human merge-or-close → drives the 0-open-issues convergence goal.
- **Low-value hardening (NOT done — verifier `discard`, pre-existing, no prod signature):** the
  client-side per-line `JSON.parse` at `api.ts:537` could be wrapped in try/catch to skip a malformed
  SSE frame instead of rejecting the stream. Defensive nicety; the throw already routes to the
  caller's existing stream-error handler. Left for a human if ever desired.
- Semantics tidy still open (cosmetic, observed 0 impact): `admin/health` `counts.api_errors` counts
  SLA-latency breaches as "errors".
