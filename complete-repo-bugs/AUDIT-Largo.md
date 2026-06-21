# Audit — Batch 6: Largo AI

Scope read: providers/anthropic.ts (tool loop), largo/question-intent.ts,
largo/intent-keywords.ts, largo/largo-store.ts (eviction), largo/run-tool.ts
(dispatch safety). Live-feed + remaining run-tool cases partially covered.

---

## ✅ FIXED this session — `extractTicker` pinned non-tickers

**File:** `largo/question-intent.ts:48`
**Bug:** The fallback uppercased the whole question then matched the first 2-5
letter token, excluding only "THE"/"AND". So **"what is the cpi print"** pinned
`"WHAT"` as the ticker; "should I buy?" → `"BUY"`; "is the FED hiking" → `"FED"`.
Largo then fetched quote/technicals/news for a bogus ticker on most non-ticker
questions — wasted tool calls + confused answers.
**Fix:** Match the ORIGINAL text (real tickers are typed uppercase), strip a `$`
cashtag, and exclude a `NON_TICKER_CAPS` set (FED, CPI, FOMC, IV, DTE, VWAP, …).
"what is the cpi print" → null (correct); "thoughts on PLTR" → PLTR. tsc clean.

---

## 🟡 LOW-MED L2 — Tool loop returns mid-reasoning text on round exhaustion

**File:** `providers/anthropic.ts:202-267`
After `maxRounds` (12) the loop's last action was pushing tool_results; the model
never got a turn to respond to them. `extractTextFromLastAssistant` then returns the
assistant text from BEFORE the final tool batch — a mid-reasoning fragment, not a
final answer. Rare (12 rounds is a lot) but yields a truncated response when it does.
**Fix:** On exhaustion, make one final `messages.create` WITHOUT tools to force a
text answer, then return that.

## 🟡 LOW L3 — Tool loop ignores per-call temperature

**File:** `anthropic.ts:206` — tool loop hardcodes `temperature: TEMPERATURE`, while
`anthropicText` honors `options.temperature` (line 138). Minor inconsistency; expose
a `temperature` param on the loop for parity.

---

## ✅ Checked & CLEARED (previously-flagged issues now resolved)
- **Prompt caching implemented** — `cache_control: { type: "ephemeral" }`
  (anthropic.ts:21). The "no caching, full system prompt every call" issue is fixed.
- **Session store LRU eviction** — `memorySessions` now evicts oldest beyond
  `MAX_MEMORY_SESSIONS` (largo-store.ts:22-24). The unbounded-Map leak is fixed.
- **Tool-loop null-on-exhaustion** — fixed; returns extracted text (anthropic.ts:267).
- **Intent keyword divergence** — fixed; intent + tool hints now share
  `intent-keywords.ts`. NightHawk intent correctly adds `get_nighthawk_edition`.
- **KNOWN_TICKERS expanded** — ~100 names (was ~20).
- **Tool dispatch safe** — `default: return { error: "Unknown tool: ..." }`
  (run-tool.ts:1036) + each call try/caught in the loop (anthropic.ts:249). No throw
  escapes; an unknown/failed tool degrades gracefully.

## Files read in full
anthropic.ts (tool loop + create paths), question-intent.ts, intent-keywords.ts,
largo-store.ts (eviction), run-tool.ts (dispatch structure + default).

## Pending (queue)
- `largo-live-feed.ts` (415) — parallel prefetch error handling / partial-failure.
- `run-tool.ts` remaining ~70 cases — individual parse/guard correctness.
- `technicals.ts`, `flow-strike-stacks.ts`, `system-prompt.ts` content review.
