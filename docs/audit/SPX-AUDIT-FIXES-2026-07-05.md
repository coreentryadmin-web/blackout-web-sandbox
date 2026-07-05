# SPX end-to-end audit fixes (2026-07-05)

Branch: `cursor/spx-audit-fixes-9d1e`

## P1 fixed

| ID | Fix | Evidence |
|----|-----|----------|
| C1 | Commentary loads server desk on cache miss; client body ignored | `spx/commentary/route.ts` → `loadMergedSpxDesk()` inside `serverCache` callback |
| C2 | JSON parse failure returns null (502), never ungrounded raw text | `spx-commentary.ts` + `spx-commentary.test.ts` |
| M1 | `gex-heatmap` + explain use `requireAnyToolApi(["spx","heatmap"])` | `gex-heatmap/route.ts:247`, `route.test.ts` launch-gate assert |
| M2 | Bootstrap seeds matrix SWR on first paint | `useMergedDesk.ts` → `mutate("/api/market/gex-heatmap?ticker=SPX", …)` |
| L1 | `isLottoPollWindow()` through 2 PM ET | `spx-play-session-guards.ts` + `useSpxLotto.ts` |
| D1 | Power hour WATCH Discord uses `action: "WATCH"` | `spx-power-hour-engine.ts` / `spx-play-notify.ts` |

## P2 fixed (second pass — audit gaps closed)

| ID | Fix | Evidence |
|----|-----|----------|
| M3 | Matrix fast poll during premarket (matches desk `sessionActive`) | `useDeskSessionPollIntervalMs` + `SpxGexMatrixHeatmap sessionActive` |
| Gates | Dedicated `spx-play-gates.test.ts` — halt, stale, macro, opening range, cooldowns, VIX, tape, confirmations | 16 hermetic tests with mocked ET/halt/session |
| MTF promote | WATCH→ENTRY promote uses `mtfHardPass` only (no soft 3m/5m bypass) | `spx-play-engine.ts` — removed `mtf?.ok` OR branch |
| U1/M5 | Matrix grey text → cyan/sky palette | `SpxGexMatrixHeatmap.tsx` — no `text-white/XX` |
| U4 | Matrix lens tabs: `aria-controls`, `tabpanel`, arrow-key roving | `SpxGexMatrixHeatmap.tsx` |
| U5 | Play action hero in `aria-live="polite"` region | `SpxTradeAlerts.tsx` |
| Early close | `noEntryCutoffLabel()` dynamic on early-close days | `spx-play-session-guards.test.ts` |
| Cron copy | `spx-evaluate` skip message 16:15 ET | `spx-evaluate/route.ts` |
| gex-positioning | `no-store` headers; gate includes `spx` | `gex-positioning/route.ts` |

## P3 / deferred (documented, not bugs)

- **Lotto halt gate** — lotto track intentionally separate from main play halt gate (product choice).
- **5-min cron force-exit lag** — inherent to `spx-evaluate` cadence; ops can tighten schedule if needed.
- **Dead desk components** — `SpxDeskPanels`, `BenzingaNewsTicker` kept for Grid/reuse; not mounted on `/dashboard`.
- **Admin tier check** — `tier === "admin"` kept for admins without `tier: premium` in Clerk metadata.

## Layout (user request)

SPX Slayer left rail is **matrix-only** — regression test in `spx-dashboard-layout.test.ts`.
