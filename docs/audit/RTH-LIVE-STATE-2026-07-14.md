# RTH LIVE STATE & CHANGE-DRIVER NOTES — 2026-07-14 (market open)

Purpose: capture the **live RTH ground truth** and the full open-item list so fixes across the
whole site can be made **off this snapshot** without waiting for the next market open. Keep this
updated — it is the source of truth for the post-open change program.

Trunk at capture: `cecb49f` (#352). Staging deployed & settled (vector-hardcore 122/122 pre-open).

---

## 1. Live-open validation battery (13:34–13:40 UTC) — ALL GREEN

| Check | Result | Live evidence |
|---|---|---|
| data-validator.mjs | **18/18 PASS** | SPY app 749.645 vs Polygon 749.66 (Δ0.002%); SPX 7521.67 vs 7523.23 (Δ0.021%); VIX 16.9 vs 16.91; SPX/SPY 10.034; put 745<flip 750.7<call 757; posture short (spot<flip); DEX −4.19B short; VEX +109B; track 11W+15L=26, 42% WR; **0 malformed floats** across 11 payloads |
| scenario "drops 1%" | **PASS** | SPX 7522.87 → 7447.64 (true −1%), **crosses γflip 7522.39 → short-γ**, pierces 7500 call wall |
| Flow-GEX lens (SPX, RTH flow) | **PASS** | OI all-call below spot; **Flow flips 7750/7745/7720/7975 → put** off today's live selling tape (e.g. 7750 oi call +$2.47B vs flow put −$512K) |

## 2. Cross-surface flip/wall dossier (13:39 UTC) — `scratchpad/rth-capture.json`

Live spot: SPX 7538.81 · TSLA 399.12 · NVDA 204.21. Ladder API returns `flip:null` **by design**
(flip served by the desk endpoint, not the ladder); Largo/desk flips below.

| Ticker | Largo/desk γflip | posture | call wall | put wall | notes |
|---|---|---|---|---|---|
| SPX | 7536.3 | long-γ (spot 7538.8 above) | 7550 | (per horizon) | max pain 7525 (0dte); regime bullish |
| TSLA | **397.60** | **long-γ** (spot 399.12 +0.38%) | 420 | 380 | **N5-1 looks resolved** — 420 is the call wall, not the flip |
| NVDA | 198.25 | long-γ (spot 204.21 +2.92%) | 210 | 195 | coherent |

Per-horizon ladder kings (dense rows all 200/103/91, status 200):
- **SPX** 0dte C7550/P7500 mp7525 · weekly C7550/P7505 mp7420 · monthly C7550/**P7300** mp7450 · all C7550/P7475 mp7400
- **TSLA** 0dte C395/P390 mp397.5 (**89 rows — verify real 0DTE chain vs fallback**) · weekly+ C395/P380 · all **C420**/P380
- **NVDA** 0dte C210/P200 mp202.5 · weekly C210/P195 · all C210/P195 mp195

## 3. OPEN ITEMS to drive fixes (off this snapshot — no next-RTH needed)

### Verify / likely-fix (from live capture)
- **[VERIFY] SPX monthly kingPut = 7300** (−3.2%, deep OTM) while weekly = 7505. Possible #352-class
  far-strike crown on the **monthly** horizon — #352's coherence tests only pinned `weekly`. Check
  monthly banner support vs ladder put-king; if they diverge, extend the `kingStrikes` canonical-wall
  override coverage to monthly/all (fix in `vector-gex-ladder.ts` + `gex-ladder/route.ts`; add a
  monthly case to `vector-hardcore-e2e.mjs`).
- **[VERIFY] TSLA 0DTE 89 rows + maxPain 397.5** — confirm this is a genuine 0DTE chain, not a
  nearest-expiry fallback mislabeled "0DTE" (the honest-gap check). If fallback, the DTE scoping must
  label it honestly (empty/near-empty, not full-width).
- **[LIKELY-RESOLVED] N5-1 TSLA flip incoherence** — live Largo shows 397.60 long-γ with 420 as the
  call wall (not a short-γ flip). Confirm the Vector **banner** shows the same flip (≈397.6) and same
  regime; if coherent across banner/terminal/Largo, close N5-1. If the banner still shows a per-expiry
  OI-crossing near 420, the flip-source unification (one flip for all surfaces) is still needed —
  ties into the held `fix/vector-surface-sync` branch.

### Cross-session bead/wall continuity (user-flagged 2026-07-14, LIVE-PROBED)
Dynamic-universe MECHANISM is sound (TTL 45d > retention 14d; cap 100; recorder unions
`listDynamicUniverseTickers()`). Live probes:
- **Dynamic recording w/o viewer — PASS**: UBER (35 ladder rows @73.83) + SNAP (9 rows @4.64) both
  have recorder wall-history trails today (4-5 samples from ~13:30→13:45, wall strengths GROWING) with
  NO viewer — `scratchpad/uber-continuity.mjs`.
- **Persistence — yesterday exists**: SPX weekly wall-history **07-14 (Tue) 25 · 07-13 (Mon) 568** ·
  **07-10 (Fri) 0** · UBER 07-14 5 · 07-13 3 · 07-10 0. (`scratchpad/prior-session.mjs`)
- **GAP A (display, = held `fix/vector-multiday-replay`)**: today's chart paints only the CURRENT
  session's rail (+ SSR "all" rail). Prior-session beads/walls are NOT drawn on today's map. This is
  the multi-day rail feature. DECISION: re-implement CLEAN on current trunk (held branch is 58 behind
  all of tonight's dense-ladder/flow/coherence work — do NOT force-rebase stale code): read+paint N
  prior sessions of walls+beads; validate live RTH. Sequence AFTER the Vector deep-sweep reports.
- **GAP B (recording/retention DEPTH)**: Friday 07-10 (a real market day, confirmed) has 0 weekly
  wall-history samples though retention (#342) is 30d — per-horizon trail history reaches only ~1
  trading day back. Root-cause: did per-horizon recording start ~Mon, or does retention/session-keying
  drop older sessions? Fix so a real multi-day history accumulates (a multi-day rail is only as deep as
  the recorded history behind it). Files: the wall-history recorder + `wall-history-retention.ts` +
  `loadSessionWallHistory`.

### Known checklist items to confirm/fix live (docs/checklist/*-july14.md)
- **N5-2 (P2)** Largo NEWS line leaks raw HTML entity `&#34;` — decode entities in the news composer.
- **N5-3 (P2)** Largo offline "SESSION WRAPPED" headline clips at 1920/1440 — CSS.
- **N4-2 (P2)** ladder body empty ~5s before fill — add skeleton.
- **1H replay bead-count anomaly (P3)** — bead-pixel count dropped mid→late at 60m; eyeball, file if real.
- Ghost backfill for narrowed horizons (first-day gap) — not built.
- AAPL one-sided horizon wall boundary flapping — watch.

### Held branches (merge AFTER live RTH validation — 56-58 commits behind trunk)
- `fix/vector-multiday-replay` — 15-session chart + wall/bead history; needs rebase over all tonight's
  vector work + live replay-across-days validation.
- `fix/vector-surface-sync` — atomic per-15s VectorHorizonSnapshot so chart/ladder/terminal/max-pain
  read ONE snapshot (fixes 4-independent-15s-clocks drift); acceptance is all live-RTH. Decide the
  single flip source here.

### Deferred (post-open, deploy-risk)
- **#86** purge Railway host fallbacks from source (DB/Redis connection strings) — dedicated PR.
- #12 AH rail Phase 4, #23 dark-pool walls / options S/R, #24 charm/theta lens — new vector features.
- #47 Helix flow drilldown, #50/#51 Cloudflare perf/RSC-Vary.

## 4. Deep live sweeps IN FLIGHT (RTH, this session) → findings appended in §6
- Vector (every ticker×TF×DTE, both GEX lens modes, indicators, walls/beads/replay, coherence)
- SPX Slayer (every signal, confluence, gate, numeric truth, cross-surface)
- Night Hawk (every play, gate, tier A+/A/B/C/F, 0DTE board, live marks, exit, latch, debrief, playbook)
- Largo/BIE (every intent, numeric-truth RTH gate, verdict falsifiers, adversarial honesty, N5-2)

## 5. Harness inventory (re-verify any fix immediately; env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY)
- `scripts/audit/data-validator.mjs` — prices/GEX/greeks/track/malformed vs Polygon+UW
- `scripts/vector-hardcore-e2e.mjs` (`npm run validate:vector-hardcore`) — 122/122 baseline
- `scripts/vector-staging-e2e.mjs` (`npm run validate:vector-push-gate`) — render gate
- `scripts/largo-hardcore-e2e.mjs` (`npm run validate:largo-hardcore`) — 70/0 baseline
- `scratchpad/scenario-verify.mjs` — scenario drops-1%
- `scratchpad/flow-verify.mjs` (bug: doubles sign — gex is pre-signed) / **`flow-dump.mjs`** (raw, use this)
- `scratchpad/rth-capture.mjs` → `rth-capture.json` — cross-surface flip/wall dossier
- `scratchpad/pane-validate.mjs` — Night Hawk 0DTE pane
- `scratchpad/zerodte-open-watch.mjs` — 0DTE first-live-session watch (14:05 checkpoint)

## 6. SWEEP FINDINGS (appended as agents report)
_(pending — Vector / SPX Slayer / Night Hawk / Largo live sweeps)_
