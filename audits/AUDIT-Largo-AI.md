# Batch 05 — Largo AI

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Plan:** `audits/AUDIT-PLAN.md` Batch 05  
> **Audited:** 2026-06-19 · **Step 2 + Step 3 complete**  
> **Scope:** 17 files — Largo store, tool defs/dispatch, intent routing, Anthropic tool loop, desk/terminal UI  
> **Cross-check:** `complete-repo-bugs/AUDIT-Largo.md` (Batch 6 scratch draft)

---

## Coverage stats

| Metric | Value |
|--------|------:|
| Files in batch | 17 |
| Files read in full | 17 |
| Lines read (approx.) | ~3,950 |
| Tool handlers in `run-tool.ts` | 72 `case` arms + 1 `default` |
| Registered tools in `LARGO_TOOL_DEFS` | 71 |
| Production findings (Step 2) | **7** |
| Second-pass notes (Step 3) | **8** |

### File inventory (all read)

| # | File | Lines | Role |
|---|------|------:|------|
| 1 | `src/lib/largo/largo-live-feed.ts` | 416 | Parallel live prefetch + prompt block formatter |
| 2 | `src/lib/largo/question-intent.ts` | 133 | Ticker pin + intent flags + turn guidance |
| 3 | `src/lib/largo/system-prompt.ts` | 51 | Static Largo persona + accuracy rules |
| 4 | `src/lib/largo/tool-defs.ts` | 423 | Anthropic tool schemas + intent-based filtering |
| 5 | `src/lib/largo/run-tool.ts` | 1,053 | Tool dispatch (Polygon/UW/desk/Postgres) |
| 6 | `src/lib/largo/intent-keywords.ts` | 36 | Shared regex patterns for intent routing |
| 7 | `src/lib/largo/largo-store.ts` | 214 | Postgres + in-memory session/history |
| 8 | `src/lib/largo/spx-desk-cache.ts` | 15 | Per-query merged SPX desk singleton |
| 9 | `src/lib/largo/technicals.ts` | 179 | Peer RS / seasonality / QQQ RS helpers |
| 10 | `src/lib/largo/flow-strike-stacks.ts` | 195 | UW strike-stack normalization + formatting |
| 11 | `src/lib/providers/anthropic.ts` | 269 | Claude client, caching, tool loop |
| 12 | `src/lib/largo-terminal.ts` | 231 | Query orchestration (feed → system → loop) |
| 13 | `src/components/LargoTerminal.tsx` | 163 | Legacy embed terminal (non-streaming) |
| 14 | `src/components/desk/LargoTerminal.tsx` | 236 | Primary desk terminal (SSE streaming) |
| 15 | `src/components/desk/LargoMessageBody.tsx` | 395 | Markdown-ish answer renderer |
| 16 | `src/components/desk/LargoThinkingState.tsx` | 119 | Loading / pipeline animation |
| 17 | `src/components/embeds/LargoWorkspace.tsx` | 34 | Dashboard embed shell |

**HTTP integration (Batch 03 — contract only):** `src/app/api/market/largo/query/route.ts`, `session/route.ts` — premium-gated, 4k question cap, SSE + JSON paths wired to `largo-terminal.ts`.

---

## Cross-check: `complete-repo-bugs/AUDIT-Largo.md`

| Prior finding | Current code | Verdict |
|---------------|--------------|---------|
| `extractTicker` pinned `WHAT`/`FED`/`CPI` on lowercase questions | `NON_TICKER_CAPS` + original-case `$?([A-Z]{2,5})` fallback (`question-intent.ts:50-61`) | ✅ **FIXED** |
| Prompt caching missing | `cache_control: { type: "ephemeral" }` on static system block (`largo-terminal.ts:64`, `anthropic.ts:18-22`) | ✅ **FIXED** |
| Unbounded in-memory session Map | LRU eviction `MAX_MEMORY_SESSIONS = 500` (`largo-store.ts:15-25`) | ✅ **FIXED** |
| Intent keyword divergence vs tool hints | Shared `intent-keywords.ts` consumed by both paths | ✅ **FIXED** |
| `KNOWN_TICKERS` too small (~20) | Expanded ~100-name set (`question-intent.ts:31-41`) | ✅ **FIXED** |
| Unknown tool throws | `default: return { error: "Unknown tool: …" }` (`run-tool.ts:1036-1037`) + per-call try/catch in loop (`anthropic.ts:247-251`) | ✅ **FIXED** |
| Tool loop returns `null` on exhaustion | Returns `extractTextFromLastAssistant` (`anthropic.ts:267`) | ⚠️ **PARTIAL** — see **B5-03** |
| Tool loop mid-reasoning fragment after max rounds | Still returns last *pre-tool* assistant text when final round is tool-only | 🔴 **OPEN** — **B5-03** |
| Tool loop ignores caller `temperature` | Hardcoded `TEMPERATURE = 0.3` in loop (`anthropic.ts:206`) | 🟡 **OPEN** — **B5-07** |
| Pending: `largo-live-feed` prefetch | Full read complete | 🔴 **NEW** — **B5-01**, **B5-02** |
| Pending: `run-tool` case review | All 72 arms read | 🟡 **NEW** — **B5-08** |
| Pending: `technicals.ts` / stacks / prompt | Read in full | 🟡 **NEW** — **B5-06** (dead export) |

---

## Step 2 — Production findings

### B5-01 · MEDIUM — SPX desk bundle prefetched on every question (ticker default bug)

**File:** `src/lib/largo/largo-live-feed.ts:40,55-64`

**Bug:** `captureLargoLiveFeed` sets `const ticker = intent.tickerHint ?? "SPX"` then gates six heavy jobs on `ticker === "SPX"`. When no ticker is pinned, `tickerHint` is `null`, so the default `"SPX"` makes the condition **always true**. Generic questions ("how is the market?", "what is CPI?") still prefetch `get_spx_play`, `get_open_plays`, `get_greek_flow`, `get_market_breadth`, `get_group_greek_flow`, and `get_macro_indicator`.

**Impact:** Extra UW/Polygon/desk API load and latency on most turns; contradicts intent guidance ("No ticker pinned — infer from chat if needed").

**Fix:** Gate on explicit scope, e.g. `intent.tickerHint === "SPX" || intent.needsSpxDesk || intent.needsPlayState` — not the defaulted ticker string.

---

### B5-02 · MEDIUM — Live feed always fires 10+ parallel tool calls per turn

**File:** `src/lib/largo/largo-live-feed.ts:42-53` (+ conditional block above)

**Bug:** Base prefetch always runs market context, calendar, SPX structure, technicals, news, flow, flow tape, dark pool, vol regime, and Night Hawk — regardless of question intent. Tool filtering (`getToolsForIntent`) only applies to Claude's loop, not the auto-capture path.

**Impact:** Every Largo message is an expensive multi-provider burst (UW rate limits, Anthropic input tokens from a large feed block, server CPU). Premium cost center with no intent-based throttle.

**Fix:** Drive prefetch keys from `LargoQuestionIntent` flags (mirror `question-intent.ts` tool hints) or cap base jobs to `get_market_context` + intent-selected feeds.

---

### B5-03 · MEDIUM — Tool loop exhaustion returns stale mid-reasoning text

**File:** `src/lib/providers/anthropic.ts:202-267`

**Bug:** After `maxRounds` (Largo passes 16), if the last iteration ends with tool calls, the loop pushes `tool_result` messages but never gives the model a final no-tools turn. `extractTextFromLastAssistant` then returns the assistant message **before** that tool batch — often a partial reasoning fragment, not a user-facing answer.

**Repro:** Complex multi-tool question that hits round limit (rare but possible on broad "full desk" asks).

**Fix:** On exhaustion, one final `messages.create` **without** `tools` to force a text answer; return that text (or a explicit "hit tool limit" fallback).

---

### B5-04 · LOW-MED — `PLAY_STATE_RE` triggers play prefetch on common words

**File:** `src/lib/largo/intent-keywords.ts:13-14` → `largo-live-feed.ts:55`

**Bug:** Pattern matches `\b(buy|sell|hold|trim|play|setup|trade|lotto|signal|outlook|analysis)\b`. Words like **"analysis"** and **"outlook"** appear in most substantive market questions, setting `needsPlayState` and pulling SPX play engine state even when the user asked about a single-name ticker or macro.

**Fix:** Tighten regex (e.g. require SPX/desk context) or only set `needsPlayState` when combined with `SPX_DESK_RE` / explicit play keywords.

---

### B5-05 · LOW — Dashboard embed uses legacy non-streaming terminal

**Files:** `src/components/embeds/LargoWorkspace.tsx:5,13` → `src/components/LargoTerminal.tsx`

**Bug:** `/terminal` uses `desk/LargoTerminal` (SSE streaming, session hydration, rich markdown). Dashboard embed imports root `LargoTerminal` — blocking JSON API, no session restore, plain `whitespace-pre-wrap` text, generic error copy.

**Fix:** Import `@/components/desk/LargoTerminal` in `LargoWorkspace.tsx` (or delete legacy component if unused elsewhere).

---

### B5-06 · LOW — `buildLargoTechnicals` exported but never called

**File:** `src/lib/largo/technicals.ts:44-107`

**Bug:** Full technical builder (Polygon daily bars, EMA stack, ATR, swing levels) is dead code. `get_technicals` tool uses `fetchPolygonMtfTechnicals` from `polygon-largo.ts` instead. Drift risk — two divergent technical pipelines.

**Fix:** Remove unused export or wire `run-tool` `get_technicals` fallback through it when MTF fetch fails.

---

### B5-07 · LOW — Tool loop hardcodes temperature

**File:** `src/lib/providers/anthropic.ts:206` vs `anthropicText` `options.temperature` (`anthropic.ts:138`)

**Bug:** `anthropicToolLoop` always uses `TEMPERATURE = 0.3`; callers cannot tune (commentary vs Largo parity).

**Fix:** Add optional `temperature` param to `anthropicToolLoop`.

---

### B5-08 · LOW — `get_analyst_ratings` returns unrelated rows when ticker absent from screener

**File:** `src/lib/largo/run-tool.ts:671-676`

**Bug:** When no analyst rows match the requested ticker, handler returns `rows.slice(0, 10)` from the **global** screener. Claude may cite other tickers' ratings as if they belong to the asked symbol.

**Fix:** Return `{ analysts: forTicker, note: "no ratings for ticker" }` when `forTicker.length === 0`.

---

## Step 2 — Cleared / solid (no production bug)

| Area | Evidence |
|------|----------|
| Session ownership | `ensureLargoSession` rejects cross-user session IDs (`largo-store.ts:42-44`) |
| History caps | Load 28 / store 50 messages; memory mode trims to 28 (`largo-store.ts:12-14,139`) |
| Stale session purge | `purgeStaleLargoSessions` with configurable retention (`largo-store.ts:180-212`) |
| Strike stack integrity | Server-side `computeFlowStrikeStacks` + prompt rules forbid invented stacks (`flow-strike-stacks.ts`, `system-prompt.ts:13-14`) |
| Tool surface parity | 71 defs ↔ 72 handlers (incl. unreachable `get_vol_anomaly`) |
| SPX desk cache lifecycle | `resetLargoSpxDeskCache()` in `prepareLargoTurn` + `finally` blocks (`largo-terminal.ts:126,175,228`) |
| Prompt accuracy rules | Strong anti-hallucination copy in static + dynamic system blocks |
| Premium API gate | `requireTierApi("premium")` on query/session routes (Batch 03) |
| Stream protocol | SSE `token` / `tool_start` / `done` / `error` events (`largo-terminal.ts`, `api.ts:460-481`) |
| Message rendering | `LargoMessageBody` handles Bottom line, verdict, tables, numeric highlight (`LargoMessageBody.tsx`) |

---

## Step 3 — Second pass (edge cases)

Additional risks, degraded-mode behavior, and UX edge cases.

### S3-01 · LOW — Stream error leaves empty assistant bubble

**File:** `src/components/desk/LargoTerminal.tsx:76-103`

On failure, code appends a **new** error assistant message while the placeholder `{ id: assistantId, content: "" }` remains — duplicate empty + error bubbles.

**Fix:** On catch, map/update `assistantId` with error text (or remove placeholder).

---

### S3-02 · LOW — In-memory sessions not user-scoped without Postgres

**File:** `src/lib/largo/largo-store.ts:48-49,62-64,136-141`

When `!dbConfigured()`, `sessionOwnedByUser` returns `true` and history is keyed only by `sessionId`. Dev/local mode: guessing another user's session ID exposes their in-memory thread.

**Risk:** Dev-only; production with Postgres is safe.

---

### S3-03 · LOW — `extractTicker` first-match wins on multi-ticker threads

**File:** `src/lib/largo/question-intent.ts:50-55`

Scans combined history + question for first `KNOWN_TICKERS` hit. Follow-up "what about flow?" after discussing NVDA and TSLA keeps whichever appeared first in history — may pin wrong symbol for live feed scope.

---

### S3-04 · LOW — `NON_TICKER_CAPS` incomplete (sector acronyms)

**File:** `src/lib/largo/question-intent.ts:25-30,58-60`

Fallback uppercase match can still pin **`IT`**, **`OR`**, **`ALL`**, etc. if typed in caps in an otherwise lowercase question. Less severe than pre-fix `WHAT`/`CPI` bug but same class.

---

### S3-05 · LOW — Duplicate desk load after live feed capture

**File:** `src/lib/largo-terminal.ts:122-126`

Live feed tools populate module cache via `getLargoSpxLiveDesk`, then `resetLargoSpxDeskCache()` clears it before the tool loop. First `get_spx_structure` / `get_options_flow` (SPX) in the loop reloads `loadMergedSpxDesk()` — redundant work on SPX-heavy turns.

---

### S3-06 · LOW — Unreachable `get_vol_anomaly` handler

**File:** `src/lib/largo/run-tool.ts:591-595`

Switch arm exists; tool not registered in `LARGO_TOOL_DEFS`. Dead code — harmless unless defs add it later without implementation review.

---

### S3-07 · LOW — User message persisted before assistant success

**File:** `src/lib/largo-terminal.ts:118`

`appendLargoMessage(user)` runs before `anthropicToolLoop`. If Claude throws after persistence, session shows orphan user turn (no assistant reply). Acceptable for chat logs; UI may look stuck on hard failures.

---

### S3-08 · LOW — `tool_start` SSE events not surfaced in desk UI

**File:** `src/components/desk/LargoTerminal.tsx:79-86`

Stream handler only appends `token` events. During long tool phases before first token, user sees thinking animation with no tool-name feedback (API emits `tool_start`).

---

### Edge-case matrix

| Scenario | Behavior | Risk |
|----------|----------|------|
| Empty question | API 400 `question is required` | ✅ |
| Question > 4000 chars | API 400 | ✅ |
| No `ANTHROPIC_API_KEY` | API 503; stream `{ type: "error" }` | ✅ |
| Non-premium user | 401/403 from `requireTierApi` | ✅ |
| Wrong-user `session_id` | Empty history / `ensureLargoSession` throw | ✅ |
| Unknown tool name from Claude | `{ error: "Unknown tool: …" }` JSON in tool_result | ✅ degraded answer |
| Tool handler throw | Caught in loop → `{ error: message }` | ✅ |
| Claude outputs pipe tables | Rendered as grid despite prompt ban | Acceptable fallback |
| No Polygon / no UW | Individual tools return errors; feed sections skipped in formatter | Graceful |
| `Number(input.days_ahead)` NaN | `toolEconomicCalendar(NaN)` → filter quirks | LOW |
| Warm serverless concurrent queries | Shared module `spx-desk-cache` singleton | Theoretical cross-request cache bleed until reset |

---

## Architecture (batch-internal)

```
POST /api/market/largo/query
  └── largo-terminal.prepareLargoTurn
        ├── largo-store (history, persist user msg)
        ├── question-intent.analyzeLargoQuestion
        ├── largo-live-feed.captureLargoLiveFeed → run-tool (parallel)
        ├── largo-live-feed.formatLargoLiveFeed → dynamic system block
        ├── tool-defs.getToolsForIntent → filtered LARGO_TOOL_DEFS
        └── anthropic.anthropicToolLoop
              └── run-tool.runLargoTool → providers / platform / spx-desk-cache

GET /api/market/largo/session
  └── largo-store.fetchLargoMessagesPublic

UI: desk/LargoTerminal → api.queryLargoStream → SSE tokens
UI: embed/LargoWorkspace → legacy LargoTerminal → api.queryLargo (JSON)
```

---

## Summary

| | |
|--|--|
| **Batch status** | ✅ Step 2 + Step 3 complete |
| **Files read** | 17 / 17 (100%) |
| **Step 2 findings** | **7** (3 MEDIUM · 1 LOW-MED · 3 LOW) |
| **Step 3 notes** | **8** LOW |
| **Prior scratch audit** | 6 items verified fixed; 2 carried open (B5-03, B5-07); 3 new prefetch issues |

### Finding counts

| Severity | Step 2 | Step 3 | Total |
|----------|-------:|-------:|------:|
| MEDIUM | 3 | 0 | **3** |
| LOW-MED | 1 | 0 | **1** |
| LOW | 3 | 8 | **11** |
| **All findings** | **7** | **8** | **15** |

**Recommended fix order:** B5-01 (ticker default gate) → B5-02 (intent-scoped prefetch) → B5-03 (final no-tools turn) → B5-05 (embed terminal parity) → B5-04 (PLAY_STATE regex).
