# BlackOut Trades — Audit Findings (living doc)

Verified issues from the production data-correctness + member-QA audit. Newest/most-severe first.
Cross-provider ground truth: Polygon + Unusual Whales REST.

**Merge policy (standing, 2026-07-06):** auto-merge fix PRs into `main` once local verification
and required CI (`verify`) are green — no per-PR approval, no end-of-day hold.

## MEMBER-QA BATCH 2026-07-13 — Invalid Date / NaNh ago (P1) · SPX hydration #418 (P0) · personal-alerts 502 (P0)

Three staging bugs from the continuous member-QA sweep. All three are code-fixable (the 502 has an
infra caveat).

**1) P1 — "Invalid Date" (Night Hawk) + "NaNh ago" (HELIX flow alerts), SAME root cause.** Several
duplicated, UNguarded date/relative-time formatters emitted NaN / Invalid Date when a timestamp
field was null/undefined/unparseable: `TickerDrawer.timeAgo` / `DarkPoolPanel.timeAgo` (unguarded
`new Date(iso).getTime()` -> NaN -> `${Math.floor(NaN/60)}h ago` = "NaNh ago"), `DarkPoolPanel.fmtDate`
(Invalid Date -> "NaN/NaN"), `FlowFeed` newest-age label (NaN ms), and `ZeroDteBoard.fmtEditionDate`
(`new Date(badYmd).toLocaleDateString()` -> "Invalid Date" in the "Night Hawk had this ..." echo row).
Fix: new shared guarded formatters `src/lib/relative-time.ts` (`relativeAge`, `shortMonthDay`) that
return "—" for null/undefined/""/unparseable input; repointed the unguarded call sites to them.
`relative-time.test.ts` covers null/undefined/bad-string/valid/future. (The already-guarded
`helix-flow-format.timeAgo` and `FlowAlertStream.timeAgo` were fine and left as-is.)

**2) P0 — React hydration #418 on /dashboard (SPX Slayer flagship).** `SpxTradeAlerts.tsx:159`
seeded useState from sessionStorage in a lazy initializer (`readCachedPlaybookShadow()`): the server
rendered null (no sessionStorage) while the client's first render used the cached playbook, so the two
diverged -> hydration mismatch. Triggered off-hours, when `!sessionLive` selects the cached panel for
render. Fix: initialize the state to null (matching SSR) and populate it from sessionStorage in a
post-mount useEffect, keeping the first client render identical to the server. No suppressHydrationWarning.

**3) P0 — GET /api/account/personal-alerts persistent Cloudflare 502 ("origin returned
invalid/incomplete response").** The route is well-guarded (try/catch -> clean JSON 502), and a clean
JSON 502 would NOT produce that CF message — that class of CF 502 means the origin never finished
responding (hang/timeout). This route's distinguishing call is the extra `clerkClient().users.getUser`,
awaited UNBOUNDED in `personal-alert-store.ts`: a Clerk Backend-API stall hangs the request until
Cloudflare's edge timeout. Fix (code): bound every Clerk call with an 8s `withClerkTimeout` race — a
hang now throws fast and the route's existing catch returns a clean JSON 502 immediately. Infra caveat:
if 502s persist after deploy, the cause is the Railway origin itself (fully down/restarting) — a timeout
can't fix a non-responding origin; that would be infra for the user to check on Railway.

**Also noted (NOT fixed — infra):** the `_next` JS-chunk 404-as-text/plain persisting 30+ min is the
Cloudflare-caches-404 / asset-deploy-skew class — a CF/deploy-config matter, not a web-repo fix.

**Status:** FIXED (code) — tsc clean; relative-time.test.ts 3/3; opacity clean; eslint clean;
npm run build OK (/dashboard, /flows, personal-alerts route compile). Live re-verify post-deploy.
