# 13 — Claude / Anthropic AI: Deep Dive + Cost Model

**Auditor:** Claude/Anthropic specialist (pass 2, extends pass-1 §01/04/05/07/09/10)
**Scope:** every Anthropic call site, model/token/round/cache/latency profile, prompt
optimization, a ground-up monthly $ cost model at 500 / 1,000 / 5,000 users, and missing
AI features worth building.
**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (READ-ONLY).
**Rates used (list prices, claude-api skill "Current Models" cached 2026-06-04 — `NOT
VERIFIED` against the actual Anthropic contract; an enterprise/committed-spend discount
would scale every number below down linearly):**

| Model | Input $/MTok | Output $/MTok | Cache-read $/MTok | Cache-write (5m) $/MTok |
|---|---|---|---|---|
| `claude-sonnet-4-6` (LARGO_MODEL) | $3.00 | $15.00 | $0.30 (0.1×) | $3.75 (1.25×) |
| `claude-haiku-4-5` (COMMENTARY_MODEL) | $1.00 | $5.00 | $0.10 (0.1×) | $1.25 (1.25×) |

These two are the only models the platform calls. `DEFAULT_MODEL = "claude-sonnet-4-6"`,
`LARGO_MODEL = "claude-sonnet-4-6"`, `COMMENTARY_MODEL = "claude-haiku-4-5"`
(`src/lib/providers/anthropic.ts:122-124`). No Opus, no Fable.

> Token estimates below use **1 token ≈ 4 chars** for prose/JSON. The codebase calls
> **no** `count_tokens` endpoint anywhere (verified: zero hits for `count_tokens`/
> `countTokens` across `src/`), so all input-token figures are *char-derived estimates*,
> not measured. Every formula shows its inputs. Where a figure needs prod telemetry, an
> invoice, or the real plan tier to confirm, it is tagged `NOT VERIFIED — needs X`.

---

## 1. Call-site inventory (every Anthropic entry point)

All traffic funnels through two functions in `src/lib/providers/anthropic.ts`:
`anthropicText()` (single-shot, `anthropic-text` telemetry key) and `anthropicToolLoop()`
(agentic loop, streaming or not). `anthropicConfigured()` gates everything.

| # | Feature | File | Fn | Model | max_tokens | Rounds | Trigger / cadence | Caching layer |
|---|---|---|---|---|---|---|---|---|
| 1 | **Largo terminal** (chat) | `largo-terminal.ts` → `anthropicToolLoop` | tool loop | sonnet-4-6 | 4096/round | ≤12 + 1 synth | Per user message, premium tier | per-user concurrency(2) + daily query budget + org kill-switch; **no response cache** |
| 2 | **SPX Live Desk AI** (commentary) | `spx-commentary.ts:562` | `anthropicText` | **haiku-4-5** | 1550 | 1 | Client poll, shared 5-min window cache | `serverCache` 5-min shared window (1 call/window platform-wide) |
| 3 | **GEX heatmap explain** | `gex-heatmap/explain/route.ts:200` | `anthropicText` | sonnet-4-6 (default) | 600 | 1 | On-demand per ticker | in-mem + Redis ~180s per ticker |
| 4 | **Flow brief** | `flow-brief/route.ts:158` | `anthropicText` | sonnet-4-6 (default) | 180 | 1 | On-demand | `serverCache` 15-min shared window |
| 5 | **Night's Watch narrative** | `nights-watch/position-narrative.ts:151` | `anthropicText` | sonnet-4-6 | 300 | 1 | On-demand per position | per-position-fingerprint Redis 5-min + daily budget + in-flight dedup |
| 6 | **SPX play Claude gate** (veto) | `spx-play-claude.ts:306` | `anthropicText` | sonnet-4-6 (default) | 500 | 1 | SPX engine cron tick (~5 min, gated) | platform_meta cache (60s + 2pt price bucket) + daily cap 40 |
| 7 | **Night Hawk synthesis** | `nighthawk/claude-edition.ts:127` | `anthropicText` | sonnet-4-6 | 4500 | 1 | Edition cron 5:30 PM ET | DB job checkpoint (1×/edition) |
| 8 | **Night Hawk critic** | `nighthawk/play-critic.ts:94` | `anthropicText` | sonnet-4-6 | 3000 | 1 | Edition cron (same run) | checkpointed with synthesis |
| 9 | **Night Hawk play explainer** | `nighthawk/play-explainer.ts:147` | `anthropicText` | sonnet-4-6 | 3200 | 1 | On-demand per play click | per-(edition,ticker) DB cache (`play_explanations`) |
| 10 | **Hunt builder** | `nighthawk/hunt-builder.ts:242` → `generateEditionPlays` | `anthropicText` | sonnet-4-6 | 4500 | 1 | Legacy/admin Hunt Modes path | none beyond #7's body |

**Defaults that matter:** `TEMPERATURE = 0.3` everywhere; client `maxRetries = 3`,
`timeout = 20s` (`anthropic.ts:146`). A single `anthropicText`/`anthropicToolLoop` call
can therefore make up to **4 HTTP attempts** — every retry re-bills input tokens. Spend
accounting (`ai-spend.ts`, `recordOrgSpend`) is fire-and-forget and matches the rates
above; it's an alerting tripwire, not a billing source of truth.

---

## 2. Per-feature token + cost profile (per single uncached invocation)

Estimates: input chars → tokens at ÷4; output assumed near `max_tokens` for generative
features (the prompts demand full structured output), lower for veto/brief.

| # | Feature | Est. input tok | Est. output tok | Model | $/call (input + output) |
|---|---|---|---|---|---|
| 1 | Largo (full 12-round loop, worst case) | see §3 | see §3 | sonnet | **~$0.30–0.55** |
| 2 | SPX commentary | ~4,500 (huge `JSON.stringify(ctx)`) | ~1,400 | haiku | 0.0045 + 0.0070 = **$0.0115** |
| 3 | GEX explain | ~600 | ~400 | sonnet | 0.0018 + 0.0060 = **$0.0078** |
| 4 | Flow brief | ~900 | ~120 | sonnet | 0.0027 + 0.0018 = **$0.0045** |
| 5 | NW narrative | ~700 | ~250 | sonnet | 0.0021 + 0.0038 = **$0.0059** |
| 6 | SPX play gate | ~2,500 (5× `JSON.stringify` blocks) | ~250 | sonnet | 0.0075 + 0.0038 = **$0.0113** |
| 7 | NH synthesis | ~9,000 (12 dossiers + chains + recap) | ~3,500 | sonnet | 0.0270 + 0.0525 = **$0.0795** |
| 8 | NH critic | ~5,000 (re-sends dossiers) | ~1,200 | sonnet | 0.0150 + 0.0180 = **$0.0330** |
| 9 | NH play explainer | ~3,500 (dossier + recap) | ~2,500 | sonnet | 0.0105 + 0.0375 = **$0.0480** |

`#2` SPX commentary input is the surprise: it's the **single largest single-shot input**
in the platform (~4,500 tok from `JSON.stringify(ctx)` of the entire desk payload —
`spx-commentary.ts:531`) yet runs on the *cheapest* model (haiku). Good model choice;
bad that it's re-sent uncached every 5-min window (see Finding C-3).

---

## 3. Largo cost model (the dominant per-user variable cost)

Largo is the only **per-user, unbounded-rounds** surface, so it dominates marginal cost.

**Loop mechanics** (`anthropic.ts:304-448`, `largo-terminal.ts`):
- `maxTokens = 4096`/round, `maxRounds = 12`, then 1 non-streaming synthesis pass.
- System = `LARGO_SYSTEM_PROMPT` (~5,062 chars ≈ **1,270 tok**) + a dynamic per-turn block
  (live feed + intent guidance, ~1,500–3,000 chars ≈ **400–750 tok**).
- Tools = intent-filtered subset of the Largo tool surface (`tool-defs.ts`, 19,271 chars
  total ≈ **4,800 tok** if all sent; a typical intent sends ~8–15 tools ≈ **1,500–3,000 tok**).
- History trimmed to `MAX_HISTORY = 28` messages.
- Each round **re-sends** system + tools + full message history + all prior tool results
  (capped at `MAX_TOOL_RESULT_CHARS = 16,000` each).

**Worst-case single Largo turn** (the input grows every round as tool results accumulate):

```
Fixed prefix per round  = system(1,270 + 600) + tools(2,200) ≈ 4,070 tok
Round r input           ≈ 4,070 + history + Σ(tool_results 1..r-1)
Assume ~3 tool rounds (typical), each tool result ~2,000 tok after cap:
  Round 1 in  ≈ 4,070 + 200 (question)               = 4,270
  Round 2 in  ≈ 4,070 + 200 + 2,000 + 500 (asst)     = 6,770
  Round 3 in  ≈ 4,070 + 200 + 4,000 + 1,000          = 9,270
  Synthesis   ≈ 4,070 + 200 + 6,000 + 1,500          = 11,770
Σ input  ≈ 32,080 tok ; Σ output ≈ 4 × ~600 = 2,400 tok
Cost = 32,080×$3/M + 2,400×$15/M = $0.0962 + $0.0360 = ~$0.13 / typical turn
```

A **pathological** turn that hits all 12 rounds with large tool results easily reaches
**$0.30–0.55** because the prefix + accumulated results are re-billed every round (the
quadratic re-send is the cost driver, not output).

**Why caching does NOT save this today** (Finding C-1): `anthropicToolLoop` passes
`system` straight through (`anthropic.ts:344`) and the system *does* carry one
`cache_control: {type:"ephemeral"}` breakpoint on the static `LARGO_SYSTEM_PROMPT`
(`largo-terminal.ts:74-81`). But:
1. **Tools render before system in the cache prefix.** The tool set is **intent-filtered
   per question** (`getToolsForIntent`, `tool-defs.ts:483-527` — different questions →
   different tool arrays). Per the prefix-match invariant, a changed tool list invalidates
   the *entire* prefix including the system breakpoint. So cross-turn cache hits only land
   when two consecutive turns happen to resolve the identical tool set. Within one turn's
   12 rounds the tools are stable, so intra-turn caching *can* work — but the breakpoint is
   on `system`, which sits *after* tools, and the per-turn dynamic block (live feed,
   timestamp via `todayEtYmd()`) is appended *after* the cached system block, which is fine —
   yet the accumulated `messages`/tool_results after the breakpoint are never cached.
2. Net effect: of the ~32K input tokens in a typical turn, only the ~1,270-tok static
   system prefix is cacheable, and only intra-turn. Cache savings ≈ 1,270 × (rounds−1) ×
   (0.9 × $3/M) ≈ **$0.008/turn** — negligible. The big re-billed mass (history + tool
   results) gets **zero** cache benefit.

---

## 4. Per-user/day invocation assumptions

These are the load assumptions for the monthly model. They are **estimates** — replace
with prod telemetry (`recordApiCall` already logs every Anthropic call to the API
dashboard; query it for real per-user rates). `NOT VERIFIED — needs prod telemetry.`

| Feature | Shared or per-user? | Assumed invocations | Basis |
|---|---|---|---|
| Largo | **per-user** | 4 turns/active user/day | premium chat; daily query budget caps abuse |
| SPX commentary (#2) | **shared** | ~78 windows/trading day (6.5h ÷ 5min) | one haiku call per 5-min window platform-wide |
| GEX explain (#3) | **shared per ticker** | ~10 tickers × ~130 windows/day (6.5h ÷ 3min) ≈ 1,300/day | cache-reader; only 1st request/ticker/3min calls |
| Flow brief (#4) | **shared** | ~26 windows/trading day (6.5h ÷ 15min) | one call per 15-min window |
| NW narrative (#5) | **shared per position fingerprint** | scales with **distinct open positions**, not users | per-fingerprint 5-min cache + daily budget |
| SPX play gate (#6) | **shared** | ≤ 40/day (hard `SPX_CLAUDE_DAILY_MAX_CALLS`) | engine tick, cache + daily cap |
| NH synthesis+critic (#7+#8) | **shared** | 1 edition/trading day = 1 synth + 1 critic | 5:30 PM ET cron |
| NH play explainer (#9) | **shared per (edition,ticker)** | ≤ 5 plays × 1 = 5/day | DB-cached after first click |

**Critical architecture note (the cache-reader rule, MEMORY.md):** every surface except
**Largo** is a shared-cache reader — its cost is **independent of user count**. Only Largo
scales linearly with active users. This is the single most important fact for the cost
model: 5,000 users do **not** multiply commentary/GEX/flow/NH cost; they multiply only
Largo (and indirectly NW narrative via more distinct positions).

---

## 5. Monthly cost model — 500 / 1,000 / 5,000 users

**Assumptions:** ~21 trading days/month. "Active user" = premium user who uses Largo on a
given day; assume **30% of users are active premium Largo users/day** (`NOT VERIFIED —
needs prod`). Largo at **$0.13/typical turn × 4 turns/day**. Shared surfaces are
flat-rate (computed once below, added to every tier).

### 5a. Shared (user-count-independent) monthly cost — computed once

```
SPX commentary  : 78 win/day × $0.0115 × 21 = $18.84/mo
GEX explain     : 1,300/day × $0.0078 × 21  = $212.94/mo   ← largest shared line
Flow brief      : 26/day × $0.0045 × 21     = $2.46/mo
SPX play gate   : 40/day × $0.0113 × 21     = $9.49/mo
NH synthesis    : 1/day × $0.0795 × 21      = $1.67/mo
NH critic       : 1/day × $0.0330 × 21      = $0.69/mo
NH explainer    : 5/day × $0.0480 × 21      = $5.04/mo
NW narrative    : ~200 distinct-pos/day × $0.0059 × 21 = $24.78/mo (scales weakly w/ users)
                                              ─────────
SHARED SUBTOTAL ≈ $276/mo   (call it $275–$300; GEX explain is ~75% of it)
```

> GEX explain dominates shared spend purely on **frequency** (per-ticker, 3-min TTL, ~10
> tickers). It runs on **sonnet** at 600/400 tokens. Moving it to **haiku** (Finding C-2)
> cuts that $213 line to ~$71 — a ~$140/mo saving with negligible quality loss for a
> 3–5-sentence structured read.

### 5b. Largo (per-user) monthly cost

```
Largo/mo = (users × active_frac 0.30) × 4 turns/day × $0.13/turn × 21 days
```

| Users | Active/day (30%) | Largo turns/mo | Largo $/mo | + Shared $275 | **Total $/mo (typical)** |
|---|---|---|---|---|---|
| 500 | 150 | 12,600 | $1,638 | $275 | **~$1,910** |
| 1,000 | 300 | 25,200 | $3,276 | $278* | **~$3,555** |
| 5,000 | 1,500 | 126,000 | $16,380 | $300* | **~$16,680** |

\* shared rises only slightly (more distinct NW positions; everything else is flat).

**Sensitivity / worst case** (heavy Largo users, $0.40/turn avg, 8 turns/day, 40% active):

| Users | Largo $/mo (heavy) | Total $/mo (heavy) |
|---|---|---|
| 500 | 500×0.40×8×0.40×$0.40×21 ≈ $13,440 | ~$13,700 |
| 1,000 | ~$26,880 | ~$27,200 |
| 5,000 | ~$134,400 | ~$134,700 |

> The 10–15× spread between "typical" and "heavy" Largo usage is the real budgeting risk.
> The **only** hard backstop today is `SPX_CLAUDE`-style... no — Largo's backstop is the
> per-user daily query budget (`largoDailyQueryBudget`) + the **org-wide kill-switch**
> (`aiSpendKillSwitchUsd`, opt-in, disabled unless env set). **Recommendation: arm the
> kill-switch in prod** (`DAILY_AI_SPEND_KILL_USD`) — without it, a prompt-injection or
> viral-usage day is financially unbounded. `NOT VERIFIED — needs to confirm the env var
> is set in Railway prod.`

---

## 6. Findings (Title · Severity · File:line · Why · Impact@500/1k/5k · Fix · Example)

### C-1 · Largo re-bills the full prompt every round; caching saves ~nothing · **High**
- **File:** `src/lib/providers/anthropic.ts:338-374`; tool filtering
  `src/lib/largo/tool-defs.ts:483-527`; cache breakpoint `src/lib/largo-terminal.ts:74-81`.
- **Code:**
  ```ts
  // anthropic.ts:344 — system passed through; tools (position 0) vary per intent
  const createParams: MessageCreateParams = { model, max_tokens, temperature, system, tools, messages };
  ```
- **Why:** Per the prefix-match caching invariant, the only `cache_control` breakpoint sits
  on `LARGO_SYSTEM_PROMPT` (~1,270 tok), but tools render *before* system and the tool set
  is intent-filtered per question, so cross-turn cache hits are rare. The bulk of input
  (history + accumulated tool results, re-sent every round) is never cached. A 3-tool turn
  re-bills ~32K input tokens; only ~1,270 are ever cacheable.
- **Impact:** @500 ≈ negligible today but caps the ceiling: caching the *stable tool list +
  system* could cut Largo input cost ~30–50%. @500 ≈ −$500–800/mo, @1k ≈ −$1,000–1,600/mo,
  @5k ≈ **−$5,000–8,000/mo** of avoidable input billing.
- **Fix:** (a) Make the tool list **deterministic and stable** — send the *full* tool set
  every turn (sorted by name) instead of intent-filtering, so tools+system form a stable
  cached prefix; intent filtering saves a few hundred tokens but destroys the cache, a bad
  trade. (b) Add a second `cache_control` breakpoint on the **last tool definition** (caches
  tools+system together) and a third on the **last message of the prior turn** so multi-turn
  conversations reuse the history prefix. (c) Verify with `usage.cache_read_input_tokens`.
- **Example:**
  ```ts
  // largo-terminal.ts — stop intent-filtering tools; send the full, name-sorted set:
  const filteredTools = [...LARGO_TOOL_DEFS].sort((a,b)=>a.name.localeCompare(b.name));
  // anthropic.ts — add a breakpoint on the last tool so tools+system cache as one prefix
  tools[tools.length-1] = { ...tools.at(-1)!, cache_control: { type: "ephemeral" } };
  ```

### C-2 · GEX explain runs on sonnet for a 3–5-sentence read · **Medium**
- **File:** `src/app/api/market/gex-heatmap/explain/route.ts:200` (`anthropicText(prompt, 600, SYSTEM)`
  → resolves to `DEFAULT_MODEL` sonnet-4-6).
- **Why:** A grounded 3–5-sentence desk read from a compact, already-computed context block
  is exactly the haiku sweet spot. It's also the **highest-frequency shared call** (~1,300/day),
  so the model choice is the dominant shared-spend lever.
- **Impact:** sonnet→haiku cuts $/call from ~$0.0078 to ~$0.0026. @any user count (shared):
  ~$213/mo → ~$71/mo = **−$142/mo flat**. Same at 500/1k/5k since it's user-independent.
- **Fix:** pass `{ model: COMMENTARY_MODEL }` (haiku) like SPX commentary already does.
- **Example:** `const narrative = await anthropicText(prompt, 600, SYSTEM, { model: COMMENTARY_MODEL });`

### C-3 · SPX commentary re-sends ~4,500-token desk JSON uncached every window · **Medium**
- **File:** `src/lib/providers/spx-commentary.ts:531` (`${JSON.stringify(ctx)}`), call at `:562`.
- **Why:** The full desk payload is serialized into the prompt every 5-min window. It's on
  haiku (cheap) and shared (1 call/window), so absolute cost is small ($18.84/mo), but the
  prompt is the largest single-shot input in the platform and most of `ctx` is stable
  window-to-window. There is **no `cache_control`** on it (`anthropicText` never sets it).
- **Impact:** @any user count (shared): low absolute ($19/mo) but it's a template for the
  bigger issue — `anthropicText` has **no caching path at all** (see C-4). At 5k users the
  commentary line stays $19/mo (shared), so this is a *latency/quality* fix more than cost.
- **Fix:** trim `deskContext()` to the fields the prompt actually references (it passes
  ~30 nested sections; the prompt names ~15). Lower input tokens → lower haiku cost +
  faster generation (currently needs `timeoutMs: 45_000`). Optionally split the stable
  desk-schema preamble from the volatile numbers and cache the preamble.

### C-4 · `anthropicText` has no prompt-caching path — every single-shot call pays full input · **Medium**
- **File:** `src/lib/providers/anthropic.ts:240-289`.
- **Code:**
  ```ts
  const body: MessageCreateParamsNonStreaming = { model, max_tokens, temperature, messages: [...] };
  if (system) body.system = typeof system === "string" ? system.trim() : system;
  // ^ never sets body.cache_control, never adds cache_control to system blocks
  ```
- **Why:** Six features (commentary, GEX, flow, NW, play-gate, all NH calls) share large,
  *stable* system prompts (the NH synthesis SYSTEM, the play-gate rubric, the commentary
  teaching rules) that are re-billed in full on every call. The `AnthropicSystemBlock` type
  already supports `cache_control`, but no caller uses it and the helper doesn't auto-add it.
- **Impact:** Most affected: NH synthesis (~9k input × 1/day, small volume) and the **SPX
  play gate** (~2,500 input, up to 40/day). Caching the stable rubric/system across the
  40 daily gate calls saves ~40 × 0.9 × (1,200 tok × $3/M) ≈ trivial today, but the pattern
  matters as call volume grows. @5k users with more NH/explain traffic the aggregate is
  ~$50–150/mo of avoidable input.
- **Fix:** add an opt-in `cacheSystem?: boolean` to `anthropicText` that, when the system is
  ≥ ~2,048 tok (haiku/sonnet 4.6 minimum is 2,048 for sonnet-4-6, 4,096 for nothing here),
  wraps the system as a single block with `cache_control: {type:"ephemeral"}`. Default on for
  the static-system callers (commentary, play-gate, NH synthesis/critic).

### C-5 · Up to 4 HTTP attempts per call silently re-bill input on retry · **Medium**
- **File:** `src/lib/providers/anthropic.ts:121,146` (`DEFAULT_MAX_RETRIES = 3`, `timeout: 20_000`).
- **Why:** The SDK retries 408/409/429/5xx with backoff. A timeout-then-success on a big
  generation (NH synthesis 4,500 out, can exceed 20s) re-bills the full input each attempt.
  `withTelemetry` only records the final outcome, so retries are invisible in telemetry
  except via `max_attempts`.
- **Impact:** Hard to size without prod 429/timeout rates (`NOT VERIFIED — needs prod retry
  telemetry`). On a rate-limited day this can 2–4× the input bill for the affected calls.
  Largo (4096/round, streaming) and NH synthesis are most exposed.
- **Fix:** (a) raise per-call `timeoutMs` for the big generations (commentary already does
  45s; NH synthesis at 4,500 out should be ≥60s with `maxRetries: 1`). (b) Largo already
  streams (good — no idle-timeout risk). (c) Log retry count by capturing `data._request_id`
  + a retry counter so the dashboard shows true attempt cost.

### C-6 · Org-wide AI-spend kill-switch is opt-in and may be unarmed in prod · **High**
- **File:** `src/app/api/market/largo/query/route.ts:127-138` (`isLargoKillSwitchTripped`),
  `aiSpendKillSwitchUsd()` returns null unless `DAILY_AI_SPEND_KILL_USD` is set.
- **Why:** Largo is the only unbounded per-user surface. The kill-switch ("disabled unless
  the env ceiling is set") is the **only** absolute backstop on total daily Anthropic spend.
  If the env var isn't set in Railway prod, a prompt-injection loop, a bug that bypasses the
  per-user budget, or a viral spike is **financially unbounded**.
- **Impact:** @500 a runaway costs hundreds/day; @5k a single bad day under the heavy-usage
  curve is **$4,000–6,000/day** with no hard stop. This is the top cost-control risk.
- **Fix:** set `DAILY_AI_SPEND_KILL_USD` in Railway prod (e.g. 3–5× expected daily spend at
  current tier), confirm the cross-replica ledger (`AI_SPEND_INCR_LUA`) is writing, and add
  the same kill-switch check to the **non-Largo** `anthropicText` surfaces (today only Largo
  consults it — NH/commentary/explain can still spend after the ceiling trips). `NOT VERIFIED
  — needs to confirm the env var is set in prod.`

### C-7 · No `count_tokens` anywhere → spend numbers are estimates, budgets are blind · **Low**
- **File:** entire `src/` (verified zero `count_tokens`/`countTokens` usage).
- **Why:** `estimateCostUsd` (`ai-spend.ts:47`) costs from the response `usage` block (which
  *is* accurate post-hoc), but there is no **pre-flight** token count, so the per-user daily
  budget is counted in **queries**, not tokens — a single 12-round, 32K-token Largo turn
  counts the same as a 1-round 5K-token turn against the budget.
- **Impact:** budget under-protects against the expensive tail. @5k the heavy-tail users are
  exactly the ones the query-count budget fails to bound.
- **Fix:** budget Largo by **tokens** not queries — sum `usage.input_tokens +
  output_tokens` (already available post-response in the loop via `trackSpend`) and bound the
  daily token total per user. Optionally pre-flight `client.messages.countTokens` on the
  assembled prompt before round 1 to reject obviously oversized turns.

### C-8 · NH critic re-sends full dossiers already sent to synthesis · **Low**
- **File:** `src/lib/nighthawk/play-critic.ts:78-94` (re-emits `formatTickerDossierText` per play).
- **Why:** The synthesis call (#7) already sent the same dossiers; the critic (#8) re-sends
  them for the same tickers. Two sequential sonnet calls in the same cron run with ~70%
  overlapping input.
- **Impact:** 1×/day shared → tiny absolute ($0.69/mo), but it's ~$0.015/run of pure re-send.
  Negligible at every tier; listed for completeness.
- **Fix:** either fold critique into a single synthesis+self-critique prompt, or (if kept
  separate) pass only the *plays + a compact dossier digest* to the critic, not the full text.

### C-9 · `temperature: 0.3` on structured-JSON extraction calls · **Low**
- **File:** `anthropic.ts:125` (global `TEMPERATURE = 0.3`), applied to commentary/play-gate/NH.
- **Why:** For the JSON-schema-constrained calls (commentary uses `output_config.format`;
  play-gate/critic parse strict JSON), non-zero temperature buys nothing and slightly raises
  reparse/refusal risk. Note sonnet/haiku 4.6 *accept* temperature (it's removed only on
  Opus 4.7+/Fable), so this is a quality nit, not a 400.
- **Impact:** marginal — occasional malformed JSON → a fallback path (commentary) or a wasted
  call (play-gate parses then charges budget only on success, good). No direct $ impact.
- **Fix:** drop temperature to 0 for the JSON-extraction calls; keep ~0.3 for Largo prose and
  NH play prose where variety helps.

### C-10 · GEX explain / flow brief / NW narrative inherit `DEFAULT_MODEL` implicitly · **Low**
- **File:** `gex-heatmap/explain/route.ts:200`, `flow-brief/route.ts:158` (no `model` opt →
  `resolveModel` → `ANTHROPIC_MODEL` env or sonnet).
- **Why:** Model selection for three shared surfaces is governed by an env var, not explicit
  per-feature intent. If `ANTHROPIC_MODEL` is ever set globally (e.g. to a pricier model for
  Largo testing), these cheap surfaces silently inherit it.
- **Impact:** config-drift risk; no cost today but a foot-gun at scale.
- **Fix:** pass an explicit `model` to every `anthropicText` call (haiku for short reads,
  sonnet only where reasoning depth matters) and reserve `ANTHROPIC_MODEL` for Largo only.

---

## 7. Prompt optimization opportunities (quality + speed, not just $)

| Opportunity | File | Win |
|---|---|---|
| Trim `deskContext()` to prompt-referenced fields only | `spx-commentary.ts:118-354` | ~30% fewer input tokens, faster haiku, less 45s-timeout risk |
| Trim play-gate's 5 `JSON.stringify` blocks to the fields the rubric uses | `spx-play-claude.ts:233-296` | ~30% input cut on up-to-40 daily calls |
| Stable + name-sorted Largo tool list to unlock caching | `tool-defs.ts:483` | enables C-1 caching, biggest single lever |
| Cache the static NH synthesis SYSTEM rubric | `claude-edition.ts:27-31` | small but free once C-4 lands |
| Move GEX explain + flow brief to haiku | C-2 / route files | −$142/mo + −$X flat, no quality loss for short reads |
| Add `cache_control` breakpoint on prior turn in Largo | `anthropic.ts` loop | multi-turn history reuse (~30–50% input cut on long chats) |

---

## 8. Missing AI features worth building (with a cost lens)

1. **Per-position Night's Watch *chat*** (vs. the current one-shot narrative #5). Reuse the
   Largo tool loop scoped to a single position + the user's book. High user value (premium
   stickiness). Cost: bound it like Largo (per-user budget + token cap). **Build on the
   cache-reader rule** — feed it the same shared option-chain cache the narrative uses.
2. **Pre-market Night Hawk *recap voice/summary*** — a single haiku call per edition turning
   the published plays into a 3-bullet "tonight's tape" for push notification. Shared, 1/day,
   ~$0.001. Trivial cost, high retention.
3. **Largo "explain this alert"** — one-shot haiku grounded on a single flow/dark-pool print
   (shared per print-fingerprint, cached). Cheap, surfaces AI on the flow feed where there's
   none today.
4. **Cross-tool "why did the engine veto?"** — surface the existing play-gate Claude thesis
   (already generated, #6) in the UI; it's computed but the `thesis`/`headline` aren't always
   shown. Zero new cost — it's already paid for.
5. **Token-budgeted Largo "deep research" mode** — opt-in, higher `maxRounds`, but billed
   against an explicit per-user token budget (ties to C-7). Monetizable as a higher tier.
6. **Batch the Night Hawk play explainers** via the Messages **Batches API** (50% cheaper,
   not latency-sensitive overnight) — pre-generate all 5 explainers right after edition
   publish instead of on first click. Halves #9's cost and removes the click-latency.

---

## 9. Summary numbers (the headline)

| Metric | Value |
|---|---|
| Models in use | sonnet-4-6 (Largo + most), haiku-4-5 (commentary only) |
| Distinct Claude call sites | 10 (2 helper fns) |
| Shared (user-independent) spend | **~$275–300/mo**, GEX-explain ≈ 75% of it |
| Largo (per-user) spend, typical | $0.13/turn → see table |
| **Est. total $/mo @ 500 / 1k / 5k (typical)** | **~$1,910 / ~$3,555 / ~$16,680** |
| **Est. total $/mo @ 500 / 1k / 5k (heavy Largo)** | **~$13,700 / ~$27,200 / ~$134,700** |
| Biggest cost lever | Largo prompt caching (C-1) + arming the kill-switch (C-6) |
| Cheapest high-value fix | GEX explain → haiku (C-2, −$142/mo flat) |
| Launch blocker | **Confirm `DAILY_AI_SPEND_KILL_USD` is armed in prod (C-6)** |

> All $ figures use **list prices** (`NOT VERIFIED` against the real Anthropic contract) and
> **estimated** token counts / usage rates (`NOT VERIFIED — needs prod telemetry from the
> `recordApiCall` API-dashboard ledger + an Anthropic invoice`). The shapes and ratios are
> reliable; the absolute totals will move with the real plan tier, the real active-user
> fraction, and the real Largo turn distribution.
