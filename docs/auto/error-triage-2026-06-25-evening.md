# error-triage — 2026-06-25 (EVENING run, 10:13 PM PT daily slot)

Autonomous daily production error triage (SDLC §3). **Fifth run today.** Checks the durable error
sink, incidents, admin health, and provider telemetry on the LIVE app (`blackouttrades.com`) for
NEW/spiking error signatures **since the prior run (LATE, ~15:45 PT @ base `5826ccc`)**, root-causes
each, then applies the FIX-vs-FLAG policy. Net-new CODE since the late run = **none** (the only two
commits — `641a861` the late-run log, `0c812b3` the e2e-sweep log — are docs-only), so this run is
**live-signal-directed**: the production error surface pointed the investigation, not a code delta.

Prior logs: `error-triage-2026-06-25.md` (12:45) · `-pm.md` (13:42) · `-night.md` (14:48) ·
`-late.md` (15:45).

## Run @ 2026-06-25 ~23:40 UTC (autonomous; fifth error-triage run)

Repo: `C:/Users/raidu/blackout-cron` (isolated cron clone). `git pull --ff-only` clean, `main` @
`0c812b3`, **tsc-green (exit 0)**. Market CLOSED.

---

### A. LIVE production triage (via Chrome bridge, logged-in admin session)

| Source | Endpoint | Result |
|---|---|---|
| Durable error sink | `/api/admin/errors?limit=200` | ✅ `{"ok":true}` — **0 durable error events** |
| Open incidents | `/api/admin/incidents` | ✅ **0 open** |
| Admin health | `/api/admin/health` | ✅ `health_ok:true`; `critical:0 / warning:0 / info:0 / api_errors:0`; `issues:[]`; `route_errors:[]`; `redis_degraded:false` |
| API dashboard (720m) | `/api/admin/apis/dashboard?window_min=720` | ⚠️ **`errors_window:1`** (`error_rate 0.125`, `recent_errors:1`); `active_retries:[]`; 120 recent_events all `ok` |
| API dashboard (24h) | `?window_min=1440` | **`errors_window:1` / `calls_window:800`** (error_rate 0.125%); 2/5 providers "healthy", 4 configured |

**One NEW telemetry signature since the late run** (which had `errors_window:0`):

```
provider : anthropic
endpoint : anthropic-text
severity : p1
ok       : false
error    : "Request timed out."
ts       : 2026-06-25T23:32:14.545Z   (~8 min before this run)
latency  : 82,961 ms   (≈ 4 attempts × 20s)
```

This is the SAME class as the night run's single Anthropic upstream timeout. The late run noted it
"did not recur"; it has now **recurred once** (night + evening = ≥2 occurrences today). It is **NOT
spiking** (1 error / 800 calls / 24h = 0.125%) and is **already handled** — see root-cause.

---

### B. Root-cause — `anthropic-text` "Request timed out" (82,961 ms)

Traced through `src/lib/providers/anthropic.ts`:

- **Caught & graceful.** `anthropicText` wraps the call in `try { … } catch { return null }`
  (anthropic.ts:380-391). So the timeout returns `null` → every caller has a "Claude unavailable"
  fallback. That is why the durable sink is empty, `health_ok:true`, and there is no incident — the
  failure is **telemetry-only**, never a crash or a user-facing 500.
- **Why ~83s.** `getClient()` builds the SDK client with `maxRetries: 3, timeout: 20_000`
  (anthropic.ts:206). A caller that passes no per-request override inherits that, so an upstream
  *slowdown* (Anthropic accepts the connection but doesn't respond within 20s) stacks to
  ~4 attempts × 20s ≈ **80s** of wall-clock before the null fallback. 82,961 ms is exactly this.
- **Caller discipline is uneven.** Of the 8 `anthropicText` call sites, only
  `nights-watch/position-narrative.ts:156` bounds itself (`{maxRetries:1, timeoutMs:20_000}`). The
  rest inherit the 80s ceiling:
  - **Request-path (a 80s block is unambiguously bad — nobody waits that long for an HTTP response):**
    `flow-brief/route.ts:158` (180 tok), `gex-heatmap/explain/route.ts:295` (600 tok),
    and `spx-commentary.ts:578` (1550 tok, the "SPX commentary rail" the dashboard names — needs a
    cron-warmed-vs-request check).
  - **Background cron (80s patience is fine off the request path):** `nighthawk/play-explainer`,
    `play-critic`, `claude-edition`, `spx-play-claude`.

**Assessment:** not a new bug, not a crash, not spiking — it's the KNOWN handled transient the prior
runs flagged. The only real gap is the ~80s tail-latency on USER-FACING request handlers.

---

### C. Action — FLAG (branch + Task), not auto-push to main

Per the FIX-vs-FLAG policy, bounding the request-path callers reduces `maxRetries` 3→1, which trades
upstream-overload (429/529) resilience for tail latency — a **product-deciding** call → **branch +
flag**, not a main push.

- **Branch:** `auto/error-triage-2026-06-25-anthropic-timeout` (`cd59a09`), **tsc + build green**.
  Bounds the TWO unambiguous request routes — `flow-brief/route.ts:158` and
  `gex-heatmap/explain/route.ts:295` — to `{maxRetries:1, timeoutMs:20_000}`, mirroring the
  already-shipped `position-narrative` precedent. Worst case ~80s → ~40s. Left `spx-commentary` and
  all background cron callers UNBOUNDED (intentional — see Task).
- **Task #1** filed with the live evidence, root cause, the tradeoff, the unbounded-caller list, and
  an alternative to consider (`signal: AbortSignal.timeout(N)` to hard-cap total wall-clock across
  retries while keeping fast 429/529 retries — pending verification the SDK honors a caller signal
  across its internal retry loop).

**No deep-pass re-run this cycle:** the late run's exhaustive 6-finder latent-throw audit covered the
net-new heatmap/UW delta + adjacent hot paths with 0 findings, and **zero code has changed since**
(only docs). Re-running an identical pass over unchanged code would be duplication/theater (explicitly
discouraged), so this run is correctly scoped to the live signal that actually moved.

---

### Result

**⚠️ ONE recurring-but-HANDLED transient (`anthropic-text` timeout, caught → null, 1/800/24h) —
root-caused to unbounded request-path retry budget; flagged on a branch + Task. Otherwise CLEAN:**
durable sink empty · 0 incidents · `health_ok:true` (all counts 0) · `route_errors:[]` · no active
retries. No fix to `main` (resilience-vs-latency product call).

### Carry-forward
- **Task #1 (this run)** — review/merge `auto/error-triage-2026-06-25-anthropic-timeout` OR adopt the
  AbortSignal total-deadline alternative OR close wontfix (accept the ~80s tail on the handled
  transient). Decide whether `spx-commentary.ts:578` is request-synchronous and belongs in scope.
- The 2 items on branch `auto/error-triage-2026-06-25` (db-cleanup `allSettled`, options-socket map
  eviction) remain open for human merge-or-close → 0-open-issues convergence.
- Durable error sink persists across runs — re-check next run (still empty this run).
- Pre-existing low-value hardening still open (verifier `discard`, no prod signature): client-side
  per-line `JSON.parse` at `api.ts:537`; `admin/health` `counts.api_errors` counts SLA-latency
  breaches as "errors"; `spx-desk.ts`/`spx-desk-merge.ts` "GEX Anchor" tone mismatch (#80, UI-owned).
