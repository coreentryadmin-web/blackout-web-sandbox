# Audit — Batches 7 & 8: SPX Desk + Admin + Frontend/Config

---

## 🟠 MEDIUM S1 — SPX signal dedup only blocks the immediately-consecutive duplicate

**File:** `providers/spx-signal-log.ts:29, 61-62`
```
function signalKey({action, direction, confidence, score, headline}) {
  return `${action}|${direction}|${confidence}|${round(score)}|${headline}`;
}
...
const prev = await getMeta(CURSOR_KEY);
if (prev === key) return;   // only compares to the LAST logged signal
```
**Bug:** Dedup is a single "last-seen" cursor. Two problems:
1. It only collapses **consecutive** identical signals. Pattern BUY → (other) → BUY
   logs the second BUY again — the cursor moved off it.
2. The key includes `score` (rounded) and `headline`, which drift between otherwise
   identical plays. A BUY at score 51 then score 52 → different key → logged as a new
   signal. Near-identical signals spam the log.

`insertSpxSignalLog` (db.ts:708) appends with **no `ON CONFLICT`/unique constraint**
on `signal_key`, so the weak cursor is the only dedup.

**How it fails:** Duplicate / near-duplicate BUY-SELL-TRIM entries in `spx_signal_log`
— pollutes signal history and any outcomes/analytics built on it (the "duplicate
alerts" class the audit targets).

**Fix:** Dedup on a stable identity within a session/time-window: e.g. key =
`action|direction|sessionDate` (drop score+headline), and add a partial unique index
+ `ON CONFLICT DO NOTHING`, or suppress re-logging the same action+direction within N
minutes regardless of score jitter.

---

## 🟡 LOW S2 — No security headers configured

**File:** `next.config.mjs` — no `headers()` block. No CSP, HSTS, X-Frame-Options,
X-Content-Type-Options. Clerk/Next cover some defaults, but adding a `headers()` with
at least `Strict-Transport-Security`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, and a basic CSP is cheap hardening for a paid
trading site. LOW (hardening, not an active vuln).

---

## ✅ Checked & CLEARED

- **`admin/apis/rescan` command execution is SAFE** — `execFile("node",
  ["scripts/analyze-api-usage.mjs"])` uses a hardcoded command + script path, no user
  input, `execFile` (no shell). Admin-gated + audit-logged. No injection vector.
- **No XSS sinks** — zero `dangerouslySetInnerHTML` in components/app.
- **No open CORS** — no `Access-Control-Allow-Origin: *` anywhere.
- **No `eval`/`new Function`/shell** — only the safe `execFile` above.
- **Admin routes** — all `app/api/admin/**` gated by `requireAdminApi` (verified in
  API-Routes batch); admin determined by role==admin OR email allowlist.
- **`next.config` image remotePatterns** — scoped to unsplash + railway, not wildcard.
- **SPX signal logging gated to market-open + BUY/SELL/TRIM** (spx-signal-log.ts:51-52).
- **SPX action routing is sound** (spx-signals.ts:355-369) — symmetric thresholds
  (score ≥22 BUY_CALL / ≤-22 BUY_PUT / |≥10| HOLD / else WAIT), monotonic grade bands
  (72/58/45/30). No threshold asymmetry or routing bug. (Note: `confidence` rewards
  factor COUNT, not agreement — can overstate when factors conflict, but `grade`
  captures conflicts separately. LOW/acceptable.)

## Files read in full
spx-signal-log.ts, admin/apis/rescan/route.ts, next.config.mjs; security sweep
(XSS/CORS/eval/child_process) across src/app + src/components.

## Pending (lower-value long tail — see coverage note in SUMMARY)
- `spx-desk.ts` (1382) and `spx-commentary.ts` (525) — full signal-math line read
  (the action-routing/threshold logic in `spx-signals.ts` specifically).
- `components/admin/**`, `components/platform/**`, `components/desk/**` — UI state.
- `hooks/**` — client data/SSE hooks.
