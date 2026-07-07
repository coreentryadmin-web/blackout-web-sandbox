# 10 — Product & Trading UX Audit (Deliverables O / P / Q + product parts of M)

**Scope:** The whole product as a *trading-intelligence platform* — the five tools (SPX Slayer dashboard, HELIX flows, Heatmaps/GEX, Largo terminal, Night Hawk) plus Night's Watch positions manager, onboarding/education, pricing/upgrade, and the trust/verification surface that decides whether a retail trader believes the numbers. This is the **product/UX lens**, not the UI-mechanics lens (that is `02-FRONTEND.md`) and not the data-plumbing lens (`01/03/04/07`). Where a finding overlaps, this file focuses on *what the trader experiences and trusts*.

**Canonical root:** `C:\Users\raidu\blackout-platform\blackout-web` (realpath `C:\Users\raidu\blackout-web`).
**Mode:** READ-ONLY. Every claim is grounded in a file:line. Runtime/prod-only claims are flagged "Not verified — needs X".

**Headline verdict (B+ on product, held back to B− on launch-readiness by trust/funnel gaps):** BlackOut is genuinely close to "Bloomberg-terminal-for-retail." The depth is real and rare for a retail product: an **11-point confluence checklist with a live pass/fail panel** (`spx-play-confirmations.ts`), an **append-only, honestly-gated public track record** (`track-record-public.ts` + `AuthProofRail` `PROOF_REAL=false`), a **deterministic, transparent Night's Watch verdict engine** that refuses to fabricate P&L (`verdict.ts`, `NightsWatchPanel.tsx`), a **cross-tool "Verified data sources" provenance ledger** in the position detail modal (`NightsWatchDetailModal.tsx:763`), and a Largo AI desk analyst that surfaces the tools it used (`largo-tool-chip`). The honesty discipline ("never render a fabricated number", em-dash + status tag off-live) is the single most premium-feeling thing in the codebase and should be protected at all costs. What holds it back from launch-grade is **not** capability — it is a cluster of **trust-eroding inaccuracies between what the marketing/nav/onboarding promise and what the tools actually render today** (Heatmaps marketed as sector/internals/tide but only renders GEX; onboarding still teaches "hunt modes" that no longer exist; upgrade-page product sigils silently never render due to a label mismatch), plus a **funnel with no free preview** (every tool is a hard premium wall) and a **money action driven by `window.prompt`**.

---

## A. Product inventory — what each tool actually delivers (verified)

| Tool | Route / entry | What it really renders (verified in code) | Trust/"shows its work" surface | Product verdict |
|---|---|---|---|---|
| **SPX Slayer** (dashboard) | `/dashboard` → `SpxDashboard.tsx` | Sniper header + intel strip + GEX ladder + unified tape + **Trade Alerts play card** (action/score/confidence, entry/stop/target, 11-point confirmations, confluence factors, play log) + **Track Record panel** (win rate, W/L/BE, cold-BUY & WATCH→ENTRY splits) + lotto 0DTE dock + commentary rail | **Strong.** Confirmations `✓/✗ label: detail`, weighted confluence factors with `+/-` weights, telemetry-driven adaptive win-rates, per-play "Educational. Not advice." | **A−.** The flagship. Dense, graded, honest. |
| **HELIX** (flows) | `/flows` → `FlowFeed.tsx` (708 LOC) | Real-time tape + velocity radar + split-flow + coordinated dark-pool + sector rotation + Night Hawk cross-ref + net-premium leaderboard + strike-stack detector + momentum chart + dark pool + **replay, CSV export, audio alerts, watchlist, ticker drawer** | **Strong.** Honest LIVE/STALE badge from newest-print age (`dataStale` >5min), per-tag explanations, CSV export = "verify it yourself" | **A−.** Best-in-class retail flow tooling. |
| **Heatmaps** (GEX) | `/heatmap` → `Heatmap.tsx` → `GexHeatmap.tsx` | **GEX/VEX/DEX/CHARM only** — gamma profile, walls, flip, regime read, per-strike matrix. Sector thermal/movers **explicitly removed** (`Heatmap.tsx:7-11`) | Server-computed regime reads, alert diffs | **B−.** Tool itself is good but **mis-marketed** (see Q-2). |
| **Largo** (terminal) | `/terminal` → `LargoTerminal.tsx` | Full-viewport AI chat, streaming, session persistence, **tool-used chips** per answer, grounded-in-live-data welcome | **Good.** `largo-tool-chip` shows which tools fed the answer | **B+.** Strong concept; trust would jump with inline citations (see P-3). |
| **Night Hawk** (playbook) | `/nighthawk` → `NightHawkFeed.tsx` | 5-slot ranked evening playbook (`PlaybookBoard`) with market recap + per-ticker dossier modal, **co-rendered with Night's Watch** | Edition-live/awaiting-close badge, dossier per play | **B+.** "Hunt modes" gone; onboarding/marketing not updated (Q-1). |
| **Night's Watch** (positions) | right column of `/nighthawk` → `NightsWatchPanel.tsx` (972 LOC) | Per-user position manager: add position, live P&L + greeks, **deterministic HOLD/TRIM/SELL/WATCH verdict**, portfolio summary, **cross-tool detail modal with verified-data ledger** | **Best in app.** Em-dash off-live, status tag, verdict reasons, provenance ledger w/ timestamps | **A.** The most institutional surface. Held back only by `window.prompt` close (P-1). |
| **Onboarding / Education** | global `OnboardingGuide.tsx` + Options 101 glossary | 7-step tour + 8-term glossary, auto-opens once per version, reopenable via Learn | Disclaimer in glossary; "not a broker" framing | **B.** Good bones; content drifted from product (Q-1). |
| **Pricing / Upgrade** | `/upgrade` → `PlanLadder` + `FeatureComparison` | One-tier "whole floor" framing, 3 Whop options, free-vs-premium matrix | Honest "no verified stats" → proof rail hidden | **B.** Solid; sigils silently missing (Q-3); no annual/lifetime risk-reversal copy. |
| **Public proof** | `/track-record` + `/embed/track-record` | Aggregate win-rate, W/L/BE, cold-buy & watch-promote paths, embeddable iframe | **Excellent.** Same aggregation as the premium desk; PII-stripped | **A.** Genuine differentiator vs signal-sellers. |

**Cross-tool integration (a real strength):** HELIX enriches Night Hawk plays with flow conviction (`FlowFeed.tsx:294-327`); the Night's Watch verdict reads GEX walls + flow + technicals + earnings (`verdict.ts`); Largo can call `get_my_positions`. This is the "every tool sees every other tool's data" principle from project memory, and it is largely realized — a major premium-feel asset.

---

## B. FINDINGS (per-issue blocks)

### Q-1 · Onboarding + landing still teach "Hunt Modes" / agents that no longer exist in the product
- **Severity:** High
- **File:** `src/lib/onboarding-content.ts`, `src/components/landing/FeaturesGrid.tsx`, `src/components/NightHawkFeed.tsx`
- **Code reference:**
  - `onboarding-content.ts:78` (Night Hawk step body): *"Run **hunt modes** to score the universe against bias, DTE, and SPX alignment when the regular session is closed."*
  - `FeaturesGrid.tsx:68` Night Hawk `spec: "Playbook · Hunt modes"`.
  - `NightHawkFeed.tsx:26-29` (comment): *"the right column is now the Night's Watch positions manager. The AgentSidebar ('Arm an Agent' / Hunt Modes) component file is kept in place but no longer rendered here."*
- **Why it's a problem:** The first-run tour and the landing arsenal both promise a "hunt modes" workflow that the `/nighthawk` page **no longer renders**. A new user follows the onboarding deep-link to `/nighthawk`, is told to "run hunt modes," and finds a playbook + a positions manager instead — no hunt-mode control anywhere. Onboarding is the single highest-trust moment of the funnel (the user is deciding whether the product is real); a promise that doesn't exist on arrival is the worst possible first impression for a paid trading tool.
- **Impact (500 concurrent users):** Every signed-in first-run user hits this exact mismatch, plus Night's Watch (a genuinely strong feature) is **never introduced** by onboarding at all — the best new surface is undiscovered while a dead one is advertised. Multiplied across the launch cohort this is systematic confusion + a "is this thing finished?" trust hit on day one.
- **Recommended fix:** Rewrite the Night Hawk onboarding step around what ships: ranked evening playbook + per-ticker dossier, and **add a Night's Watch step** ("track your live positions with a hold/trim/sell read"). Change `FeaturesGrid` Night Hawk `spec` to e.g. `"Playbook · Dossiers"`. Either delete the dead `AgentSidebar`/`DayTradeAgentWorkspace`/`AgentPowerModal` files or restore the feature — don't ship onboarding for a removed feature.
- **Example change:**
  ```ts
  // onboarding-content.ts — Night Hawk step
  body: "After the close, Night Hawk builds tomorrow's ranked swing/leap playbook with a per-ticker dossier. Then track your live options in Night's Watch — live P&L plus a hold/trim/sell read on every contract.",
  ```

### Q-2 · Heatmaps is marketed as sector/internals/tide but the page renders GEX only
- **Severity:** High
- **File:** `src/components/Heatmap.tsx`, `src/components/landing/FaqSection.tsx`, `src/components/landing/FeaturesGrid.tsx`, `src/components/Nav.tsx`
- **Code reference:**
  - `Heatmap.tsx:6-12` (comment): *"The legacy GEX|Sectors switch and the sector thermal / movers view **were removed** — those source components still exist (used by other tools) but no longer render here."* → renders only `<EngineStatusBar/> + <GexHeatmap ticker="SPY"/>`.
  - `FaqSection.tsx:74-76` (Q "Is there a market overview / heatmap?"): *"sector heatmaps, leaders and laggards, internals (TICK / TRIN / ADD), market tide, and the macro catalysts on the calendar."*
  - `FeaturesGrid.tsx:51` Heatmaps desc: *"sector heatmaps, leaders and laggards, internals and market tide."*
  - `Nav.tsx:19` Heatmaps sub: *"Read the regime at a glance."* (vague enough to survive)
  - `grep` confirms `SectorThermal` now renders only in `AdminSpxDashboard.tsx` + docs, **not** on `/heatmap`.
- **Why it's a problem:** A paying user opens Heatmaps expecting the "market-intelligence layer" with internals (TICK/TRIN/ADD), market tide, sector leaders/laggards, and a macro calendar — and gets a single-ticker GEX gamma profile for SPY. The FAQ even names specific indicators ("TICK / TRIN / ADD") that the page does not show. This is a concrete, falsifiable marketing claim the product fails to deliver — exactly the kind of thing a churned reviewer screenshots.
- **Impact (500 concurrent users):** Heatmaps is one of five headline "instruments." If 1-in-5 tools visibly under-delivers vs the sales page, the whole "institutional-grade" promise is undermined and refund/chargeback risk rises (Whop). It also makes the genuinely good GEX tool look like a downgrade rather than a focused feature.
- **Recommended fix:** Pick one: **(a)** restore the sector/internals/tide view on `/heatmap` (the components exist — `SectorThermal`, tide data is fetched for the desk), or **(b)** re-cut all marketing to match: rename the tool to "GEX / Dealer Positioning," rewrite the FAQ + FeaturesGrid desc to describe gamma walls / flip / regime / VEX-DEX-CHARM (which *is* impressive), and drop the TICK/TRIN/ADD/tide/sector claims. (b) is the honest, fast launch fix; (a) is the bigger product win.
- **Example change (FAQ, option b):**
  ```
  Q: Is there a dealer-positioning heatmap?
  A: Yes — GEX. Dealer dollar-gamma mapped across the chain: support/resistance gamma
     walls, the gamma flip, and the regime read, plus vanna (VEX), delta (DEX) and charm
     lenses. You see what market makers are forced to do, and where liquidity pulls price.
  ```

### Q-3 · Upgrade-page product sigils silently never render (label key mismatch)
- **Severity:** Medium
- **File:** `src/components/upgrade/FeatureComparison.tsx`, `src/components/auth/AuthProofRail.tsx` vs `src/lib/upsell-features.ts`
- **Code reference:**
  - `FeatureComparison.tsx:5-11` and `AuthProofRail.tsx:5-11` both key the sigil map on `"Live HELIX flow feed"`, `"SPX live dashboard"`, `"Largo AI terminal"`, `"Night Hawk scanner"`, `"Full heatmaps"`.
  - But `upsell-features.ts:24-66` `FEATURE_MATRIX` labels are `"HELIX live flow feed"`, `"SPX Slayer desk"`, `"Largo AI desk analyst"`, `"Night Hawk evening playbook"`, `"Strike-level heatmaps"`.
  - `LABEL_TO_MARK[row.label]` therefore returns `undefined` for **every** row → `ProductMark` never renders; the comparison table falls back to a plain `✓`.
- **Why it's a problem:** The upgrade page is where the brand's "Living Terminal" product sigils are supposed to make the offer feel premium and concrete (each capability gets its product mark). Because the keys drifted from the data, **none of the sigils show** — the table is plain checkmarks. It's a silent regression: nothing errors, the feature just quietly doesn't happen, so it survives review. The conversion surface looks more generic than designed.
- **Impact (500 concurrent users):** Directly on the paid-conversion page. Every visitor sees a less-premium comparison table than intended; subtle but it's the exact screen where "does this look worth $111/mo" is decided.
- **Recommended fix:** Make the map key off the real labels (or, better, add a `mark?: MarkProduct` field to `FeatureRow` so the data owns its sigil and the two components can't drift again).
- **Example change:**
  ```ts
  // upsell-features.ts
  export type FeatureRow = { label: string; detail: string; free: boolean; premium: boolean; mark?: MarkProduct };
  // ...{ label: "HELIX live flow feed", ..., mark: "helix" }, etc.
  // component: {row.mark && <ProductMark product={row.mark} ... />}
  ```

### P-1 · The only place a user types a dollar figure that books realized P&L is a `window.prompt`
- **Severity:** High
- **File:** `src/components/nights-watch/NightsWatchPanel.tsx`
- **Code reference:** `NightsWatchPanel.tsx:445` `const raw = window.prompt("Close ${position.ticker} ... exit premium per contract?", ...)`; delete at `:477` `window.confirm(...)`.
- **Why it's a problem:** Closing a position is the moment Night's Watch turns "unrealized" into a logged realized result — the one number that makes the verdict engine's track record meaningful. Doing it through an unstyled OS `prompt` is (1) off-brand against an otherwise institution-grade panel, (2) unvalidated until after submit, (3) no numeric keypad on mobile, and (4) **suppressible/throttled in installed-PWA and some mobile browsers** — meaning a user on the phone (the FAQ explicitly sells the PWA) may be unable to close a position at all. This is the single least-premium interaction in the product and it sits on the money path. (Also raised in `02-FRONTEND.md` I-05; restated here because it's a *trust/credibility* defect, not just a UI one.)
- **Impact (500 concurrent users):** Mobile/PWA users who can't close a position silently get a dead-end on a financial action — the kind of thing that produces "this broke when I needed it" reviews. On desktop it reads as unfinished on the highest-stakes click.
- **Recommended fix:** Replace with the existing `<Modal>` + numeric `<input>` pre-filled with `valuation.mark`, inline validation, and a typed-confirm for delete — all primitives already used elsewhere in this very file.

### P-2 · No free-tier preview — every tool is a hard premium wall, so the 500-user funnel has nothing to convert on
- **Severity:** High (product/growth)
- **File:** `src/app/(site)/dashboard|flows|heatmap|terminal|nighthawk/page.tsx`
- **Code reference:** every tool page opens with `await requireTier("premium");` (e.g. `dashboard/page.tsx:9`, `flows/page.tsx:8`, `terminal/page.tsx:7`). `grep` for `requireTier("free")` / `tier === "free"` → **no public preview path exists**. The only free APIs are `market/ticker-search` (`upsell-features.ts:5`).
- **Why it's a problem:** A free/logged-in user can see the marketing and the public track record, but **cannot experience a single tool** before paying. For a launch scaling 10→500, the conversion model is "trust the sales page, pay $111, then see the product." That's a high-friction, high-refund funnel for a category (trading tools) where buyers are burned by signal-sellers and expect to kick the tires. The product is good enough that *showing* it would convert far better than *describing* it.
- **Impact (500 concurrent users):** Caps top-of-funnel conversion and inflates refund/chargeback rate (every refund is a Whop dispute + a `free`-downgrade reconcile). The strongest assets (live tape, the graded play card, Largo) are exactly what would sell the product and they're invisible pre-purchase.
- **Recommended fix:** Add a **delayed / throttled free preview** that stays inside the cache-reader scaling rule: e.g. HELIX tape with a 15-min delay and a blurred-row upsell after N rows; a read-only SPX play card from the public track record's last closed play; Largo limited to 1-2 questions/day. All can be served from existing caches/Postgres without new upstream calls, so it costs nothing at the 2 rps UW ceiling. This is the highest-ROI growth change available.

### P-3 · Largo shows *which* tools it used but not *what they returned* — no inline citations
- **Severity:** Medium
- **File:** `src/components/desk/LargoTerminal.tsx`, `src/components/desk/LargoMessageBody.tsx`
- **Code reference:** `LargoTerminal.tsx:174-182` renders `msg.tools` as `largo-tool-chip` pills (tool *names*), but `LargoMessageBody.tsx` (394 LOC) renders markdown with no citation/source affordance (`grep` for `source|cite|Sources` → none).
- **Why it's a problem:** Largo's whole pitch (FAQ: *"answers grounded in live data and shows its work"*) rests on trust that the numbers in the answer are real and current. Showing tool *names* ("get_spx_desk", "get_flow") is a start, but a desk analyst earns trust by **citing the value and its timestamp** ("SPX 6,012 as of 14:32 ET, GEX flip 6,000"). Right now a user must take the prose on faith; there's no way to see the underlying figure the model read. Night's Watch already solved this exact problem with the "Verified data sources" ledger (`NightsWatchDetailModal.tsx:763`) — Largo should match it.
- **Impact (500 concurrent users):** Largo is positioned as the premium differentiator; without visible grounding it reads like "another ChatGPT wrapper," which is precisely the objection the FAQ tries to pre-empt ("never a guess pulled from thin air"). Trust ceiling on the flagship AI feature.
- **Recommended fix:** Have the tool-loop return a compact `{tool, key_value, as_of}` summary alongside the answer and render a collapsible "Sources" footer per assistant message (reuse the `DataSourcesLedger` pattern). Even a one-line "Read: SPX 6,012 · GEX flip 6,000 · tide bullish — 14:32 ET" under the answer would materially raise trust.

### P-4 · Dead Night Hawk "agent" components still ship in the bundle (product debris)
- **Severity:** Low
- **File:** `src/components/nighthawk/AgentSidebar.tsx`, `DayTradeAgentWorkspace.tsx`, `AgentPowerModal.tsx`, `AgentFilterFields.tsx`
- **Code reference:** `grep -rn "import.*AgentSidebar|<AgentSidebar|import.*DayTradeAgentWorkspace"` → **no import/render sites**; only the explanatory comment in `NightHawkFeed.tsx:26-29` references them.
- **Why it's a problem:** These are the implementation of the removed "Hunt Modes" feature (Q-1). Kept "in place but no longer rendered," they are dead code that still adds to the client bundle surface, confuses the next engineer about what the product *is*, and is the source the onboarding/marketing copy was written against. Dead product surfaces are how onboarding drifts from reality (Q-1) in the first place.
- **Impact (500 concurrent users):** Negligible runtime; real maintenance/clarity cost and a standing risk that someone "fixes" onboarding by re-pointing it at these instead of deleting them.
- **Recommended fix:** Decide explicitly — if Hunt Modes is gone for good, delete the four components and the stale comment; if it's coming back, ticket it and keep onboarding silent until then. Don't leave a removed feature's UI resident.

### P-5 · Disclaimers are present but inconsistent across tools — strong where it's low-stakes, missing where it's high-stakes
- **Severity:** Medium
- **File:** multiple (disclaimer present: `SpxTradeAlerts.tsx`, `NightsWatchPanel.tsx`, `GexHeatmap.tsx`, `OnboardingGuide.tsx`, `PlayDetailModal.tsx`, `DayTradeSignalCard.tsx`, `PlaybookPlayRow.tsx`, `NightsWatchDetailModal.tsx`, `PricingSection.tsx`)
- **Code reference:**
  - Present and good: `SpxTradeAlerts.tsx:206` & `:383` *"Educational. Not advice. Every trade is your own decision."*; `NightsWatchPanel.tsx:959` *"Analysis from BlackOut signals — not financial advice. You decide."*
  - **Gap:** the SPX play card only prints the disclaimer **when a BUY/levels block renders** (`SpxTradeAlerts.tsx:382` guarded by `play.levels.entry != null && action !== SCANNING/WATCHING`). The 0DTE **lotto** block has it (`:206`), but the main HERO action line + the confluence-factors list can show an actionable lean (e.g. "I like 6010C") without the disclaimer on screen at that moment. `FlowFeed.tsx`/`FlowAlertStream.tsx` (the flagship tape that users read as buy/sell signals) carries **no per-view disclaimer** at all.
- **Why it's a problem:** For a US options product the "educational, not advice" framing is both a trust signal and a liability posture. It should be consistently visible on every surface that renders something a user could read as a trade instruction — especially HELIX (where large prints are explicitly framed as "where smart money is positioning") and at all phases of the SPX play card, not only when a levels block happens to render.
- **Impact (500 concurrent users):** Compliance/liability exposure scales with users; inconsistent disclaimers also read as "they slapped it on some screens" rather than a deliberate stance. The onboarding correctly frames "not a broker / your own decision" — the tools should not silently drop it on the highest-signal screens.
- **Recommended fix:** Add a persistent, low-weight footer disclaimer to the HELIX page frame (one line under the filter bar or in the `PageHeader`), and move the SPX play-card disclaimer out of the levels-gated block so it shows in every non-SCANNING phase. Centralize the string so it's identical everywhere.

### P-6 · SPX desk "Track Record" panel and the public proof can disagree on visibility, with no "what counts as a win" explainer
- **Severity:** Medium
- **File:** `src/components/desk/SpxTrackRecordPanel.tsx`, `src/lib/track-record-public.ts`, `src/components/embeds/TrackRecordEmbed.tsx`
- **Code reference:** `SpxTrackRecordPanel.tsx:51-54` empty state *"Track record warming up — no closed plays logged yet"*; `track-record-public.ts:67-70` returns `available:false` / "warming up" until `total_closed > 0`. Both surface a win-rate % (`pct(overallWr)`), but **neither defines what a "win" is** (target hit? MFE ≥ X pts? closed green?).
- **Why it's a problem:** A win-rate number with no methodology is exactly the claim retail traders have learned to distrust (every signal-seller quotes one). The product's biggest credibility asset — an honest, append-only log — is undercut by not *explaining the rule*. The FAQ says "scored by its original grade, with best- and worst-case excursion recorded," which is great, but that explanation lives only in the FAQ, not next to the number on the desk or the public card.
- **Impact (500 concurrent users):** The headline `track-record` page and the in-desk panel are prime trust surfaces; an unexplained win-rate is a weaker proof than a defined one. At scale, a skeptical prospect bounces instead of converting.
- **Recommended fix:** Add a one-line, hover/tooltip methodology next to the win-rate everywhere it appears ("Win = play reached its target before its stop, scored against the grade it was issued at. Append-only, no edits."). Surface `avg_mfe_pts` (already computed in `paths`) on the public card as concrete evidence. Consider a "how we score" link to a short public methodology page (not the premium-gated `docs/`).

### P-7 · Trading jargon density assumes expertise the onboarding glossary only partially covers
- **Severity:** Low–Medium
- **File:** `src/components/desk/SpxTradeAlerts.tsx`, `GexHeatmap.tsx`, `src/lib/onboarding-content.ts`
- **Code reference:** The desk renders `Δ`, `Θ/day`, `IV`, `B/E`, `Dist→K`, `OI` (`NightsWatchPanel.tsx:579-586`), `VEX/DEX/CHARM`, `gamma flip`, `MTF`, `MFE`, `cold BUY`, `WATCH→ENTRY`, `confluence factors`. The glossary (`onboarding-content.ts:91-100`) covers **8 terms** (Call/Put, 0DTE, Strike, GEX, VWAP, Premium, Dark pool, IV) — it does **not** cover delta/theta/charm/vanna/MTF/MFE/breakeven/DTE/"cold BUY"/"WATCH→ENTRY".
- **Why it's a problem:** The FAQ markets to "serious beginners … covered by the in-app Learn layer," but the Learn layer's glossary stops well short of the vocabulary the desk actually uses. A newer trader hits `Θ/day`, `Dist→K`, `WATCH→ENTRY`, or the DEX/CHARM tabs with no in-context help. Premium tools earn trust partly by being *legible*; unexplained jargon reads as gatekeeping, not depth.
- **Impact (500 concurrent users):** Suppresses activation/retention for the beginner segment the marketing explicitly courts. The expert segment is fine; the funnel the FAQ promises ("serious beginners") will bounce.
- **Recommended fix:** Extend the glossary to the terms the desk renders (greeks, DTE, B/E, MTF, MFE, the "cold BUY"/"WATCH→ENTRY" path names, GEX flip vs walls, VEX/DEX/CHARM in one line each). Even better: add tiny `?`/tooltip affordances on the in-desk metric labels (`Metric` already has a `label` slot) that surface the glossary def on hover/tap. Keep it reduced-motion-safe.

### P-8 · No alert/notification delivery the product implies, so "alerts the moment it prints" is currently in-tab-only
- **Severity:** Medium
- **File:** `src/lib/push/send-web-push.ts` (inert — see `07-TOOLS-INTEGRATIONS.md` I-8), FAQ `FaqSection.tsx:80` ("How do alerts work?")
- **Code reference:** FAQ: *"BlackOut surfaces live, in-app alerts the moment flow and desk state change … The signal reaches you in real time."* But web-push is not installed (`07-TOOLS-INTEGRATIONS.md` I-8: `web-push` absent → `sendWebPush` always no-ops), and the in-app "alerts" are the audio beep (`FlowFeed.tsx:44` whale beep, `SpxTradeAlerts.tsx:28` play beep) + visual stream — **only while the tab is open and focused enough to play audio**.
- **Why it's a problem:** The product sells "the signal reaches you in real time," and a 0DTE trader's mental model of "alert" is a phone push when they're not staring at the tab. Today there is no off-tab delivery: subscriptions can be stored but nothing is ever sent. A user who opts into alerts and gets nothing while away from the screen experiences a broken core promise.
- **Impact (500 concurrent users):** This is the feature most likely to generate "I missed the move, your alerts don't work" support tickets, especially on the PWA the FAQ promotes ("alert-first, glanceable command surface"). Trust + retention hit on a headline claim.
- **Recommended fix:** Either (a) install `web-push` and ship real push for the GEX/flow/play alerts (the subscribe + send scaffolding already exists), or (b) re-scope the alert copy to "live in-app alerts while the desk is open" until push ships. Don't market push-style "reaches you in real time" while delivery is inert.

### P-9 · The flagship SPX play card is invisible outside RTH, with no "here's tonight's plan instead" handoff
- **Severity:** Low–Medium
- **File:** `src/components/desk/SpxTradeAlerts.tsx`, `src/components/SpxDashboard.tsx`
- **Code reference:** `SpxTradeAlerts.tsx:268` `const show = play != null && live && sessionActive;` → off-session it renders only `:300` *"Session closed · desk re-arms 6:30 AM PT."* The dashboard's main column is then effectively empty after hours.
- **Why it's a problem:** A user who pays and first logs in at night (a very common pattern — people buy after dinner) opens the flagship desk and sees "Session closed" with no actionable content. The product *has* the perfect after-hours fill — Night Hawk's evening playbook + the pre-market brief — but the dashboard doesn't surface or link to it from the closed state. The most-visited page is dead exactly when a chunk of new buyers first arrive.
- **Impact (500 concurrent users):** Weak first impression for the after-hours cohort of the launch; the dashboard's "session closed" empty state is a missed cross-sell to Night Hawk (which *is* the after-hours product). Activation suffers.
- **Recommended fix:** When the session is closed, replace the empty play card with a compact handoff: "Market's closed — here's tomorrow's playbook →" linking to `/nighthawk`, plus the latest Night Hawk top play and the pre-market brief if available. Turns dead time into the intended overnight-recon workflow.

### P-10 · Premium feel is uneven: design-system tools feel institutional, bespoke desk panels feel hand-rolled
- **Severity:** Low
- **File:** `src/components/nights-watch/*` (polished) vs `src/components/desk/FlowAlertStream.tsx`, `FlowBrief.tsx`, `VelocityRadar.tsx`, `SplitFlowRadar.tsx`, `FlowFeed.tsx` filter bar (bespoke)
- **Code reference:** Night's Watch uses `ui/` primitives (`Card`, `Badge`, `Button`, `EmptyState`, `Skeleton`, `Modal`) and reads premium; the HELIX surface uses inline-hex literals and ad-hoc panels (`FlowFeed.tsx:464` `style={{color:"#00e676",textShadow:...}}`, `FlowFeed.tsx:514-518` bespoke input). (Mechanics in `02-FRONTEND.md` I-10/I-18.)
- **Why it's a problem:** The product's "Bloomberg-for-retail" feel is only as strong as its least-polished flagship surface, and HELIX is the most-used one. Two parallel styling systems mean spacing/radius/header treatments drift between tools, so the experience oscillates between "institutional" (Night's Watch) and "hand-built" (HELIX filter bar). Premium perception is set by the *weakest* daily-driver, not the strongest hidden one.
- **Impact (500 concurrent users):** Subtle but pervasive — it's the difference between "this feels like a $1,111/yr terminal" and "this feels like a powerful but indie tool." Affects price-justification and word-of-mouth.
- **Recommended fix:** Migrate the HELIX right-column panels and filter bar onto the `ui/` `Panel`/`Stat`/`Badge`/`Button` primitives and brand color tokens (`text-bull`/`text-bear`/`text-gold`) so the flagship tape matches the polish of Night's Watch. This is the same migration `02-FRONTEND.md` recommends for CSS reasons; the *product* reason is premium-feel consistency on the most-used screen.

### P-11 · "Real-time, tick by tick" claim overstates the actual cadence (cache-reader + 30s poll)
- **Severity:** Low (accuracy)
- **File:** `src/components/landing/FaqSection.tsx`, `src/components/FlowFeed.tsx`
- **Code reference:** FAQ `FaqSection.tsx:84` *"Is the data really real-time? Yes — everything streams live, tick by tick … the instant the market moves."* Reality: HELIX uses SSE *plus* a `FLOW_POLL_MS = 30_000` (`FlowFeed.tsx:40`) REST fallback; desk pulse falls back to 1s polling; the architecture is explicitly **cache-reader** (Redis-warmed), and the LIVE badge itself goes amber "Stale" after 5 min (`FlowFeed.tsx:437`). It's *near*-real-time and honestly badged in-app, but "tick by tick … the instant the market moves" is stronger than the system delivers.
- **Why it's a problem:** The in-app honesty (Stale badge, em-dash off-live) is excellent and builds trust; the marketing copy then over-claims in a way the product's own UI contradicts (a user watching the "Stale 6m" badge will notice). Over-claiming "tick by tick" is unnecessary because the real story (sub-minute institutional flow, honestly badged) is already compelling.
- **Impact (500 concurrent users):** Minor, but a sophisticated buyer who compares the "tick by tick" promise to the visible 30s cadence / Stale badge loses a little trust precisely where the product is otherwise winning it.
- **Recommended fix:** Soften to match reality and lean into the honesty differentiator: "Live institutional flow, streamed in seconds — and we badge it Stale the moment it isn't fresh, so you're never trading a frozen tape." Truthful *and* a stronger sell than competitors' unqualified "real-time."

### P-12 · Onboarding never surfaces the product's best trust asset (the public track record / proof)
- **Severity:** Low
- **File:** `src/lib/onboarding-content.ts`, `src/components/auth/AuthProofRail.tsx`
- **Code reference:** The 7-step tour (`onboarding-content.ts:35-88`) walks the five tools but never points the user at `/track-record` or the in-desk Track Record panel; `AuthProofRail` hides the proof rail entirely on `/upgrade` when `PROOF_REAL=false` (`AuthProofRail.tsx:33`).
- **Why it's a problem:** The single most persuasive, most-honest artifact in the product — an append-only, methodology-defined, public win-rate — is the one thing a new user is *not* shown during the moment they're forming trust. When real data exists, this is the proof that separates BlackOut from signal-sellers; the onboarding should route to it.
- **Impact (500 concurrent users):** Lower trust/conversion than the assets warrant. The proof exists and is honestly gated; it's just under-promoted in the funnel.
- **Recommended fix:** Add a tour step (or a line in the "welcome" step) linking to the public track record once `available`; when `PROOF_REAL` flips true, show the proof rail on `/upgrade`. Make the honesty visible — "judge the grader on its own logged results" is a great line that's currently buried in the FAQ.

---

## C. What is genuinely premium / institutional (keep and protect)

- **Honesty discipline is the brand.** Night's Watch never fabricates P&L (em-dash + `live/pending/unavailable` status tag, `NightsWatchPanel.tsx:558-573`); the verdict engine returns `watch` when it can't judge (`verdict.ts` HONESTY RULE comment); HELIX badges Stale after 5 min; `AuthProofRail` refuses to ship fake stats (`PROOF_REAL=false`). This is rare in retail trading products and is the core trust asset — **do not let any growth pressure erode it.**
- **The Night's Watch "Verified data sources" provenance ledger** (`NightsWatchDetailModal.tsx:763-805`) — each source with ok-state + `asOf` timestamp — is exactly the institutional "show your work" surface. This pattern should propagate to Largo (P-3) and the SPX play card.
- **The SPX play card is a real decision surface, not a signal:** action + numeric score + confidence + entry/stop/target + **11-point ✓/✗ confirmations** + weighted confluence factors + invalidation + telemetry-adjusted win-rates. The "one thing that kills the trade" framing (invalidation) is genuinely pro-grade.
- **HELIX is feature-dense in the right ways:** velocity spikes, split-flow, coordinated dark-pool, sector rotation, Night Hawk cross-reference, replay, CSV export, audio. The CSV export in particular says "verify the tape yourself," which builds trust.
- **Cross-tool data sharing is largely realized** (flow→Night Hawk conviction, GEX/flow/technicals→verdict, positions→Largo) — the "every tool sees every tool" principle is a premium differentiator.
- **Public, embeddable track record** (`/track-record` + `/embed/track-record`) reusing the *same* aggregation as the premium desk so the public number can't disagree with the internal one — a strong anti-signal-seller move.
- **Onboarding + Options 101** exist, auto-open once, are reopenable, and frame "not a broker / your own decision" correctly.
- **Error/empty states are on-brand and honest** across the desk (Stale badges, "warming up," "Session closed · re-arms 6:30 AM PT").

---

## D. Missing features that would close the gap to "Bloomberg Terminal for retail"

(Highest product leverage first; all are additive, none break the cache-reader scaling rule.)

1. **Free/throttled preview of at least one tool (P-2)** — the biggest conversion lever; serve from existing caches (delayed HELIX, read-only last play, 1-2 Largo Qs/day).
2. **Real push notifications (P-8)** — the alert delivery the product already markets; scaffolding exists, just needs `web-push` + wiring.
3. **Largo inline citations / sources footer (P-3)** — turns "AI wrapper" perception into "grounded desk analyst."
4. **A defined, visible win-rate methodology + MFE on the public card (P-6)** — converts the honesty asset into a closing argument.
5. **After-hours dashboard handoff to Night Hawk + pre-market brief (P-9)** — fills the flagship's dead time for the evening-buyer cohort.
6. **Alerts center / history** — beyond the ephemeral audio beep: a persistent in-app list of fired play/flow/GEX alerts a user can scroll (the data is already produced; there's no durable per-user alert inbox surfaced in the product).
7. **A "macro calendar / catalysts" surface** the FAQ already promises (`FaqSection.tsx:75`, "macro catalysts on the calendar") — earnings data is fetched for HELIX (`fetchEarningsCalendar`) but there's no calendar view; either build it or drop the claim.
8. **Saved Largo threads / shareable analysis** — sessions persist per-tab (`sessionStorage`), but there's no thread history or shareable read; a desk analyst that forgets every session caps its stickiness.

---

## E. Trust scorecard (does it show its work / verified data / disclaimers?)

| Trust dimension | State | Evidence |
|---|---|---|
| Shows its work (methodology visible) | **Strong** on SPX (11-pt confirmations + factors) and Night's Watch (verdict reasons + provenance ledger); **partial** on Largo (tool names, not values) | `spx-play-confirmations.ts`, `verdict.ts`, `NightsWatchDetailModal.tsx:763`, `LargoTerminal.tsx:174` |
| Refuses to fabricate data | **Excellent** | em-dash off-live, `watch` on no-data, `PROOF_REAL=false` |
| Honest freshness signaling | **Excellent** | HELIX Stale badge, EngineStatusBar provider liveness |
| Disclaimers | **Good but inconsistent** (P-5) — strong on lotto/Night's Watch, gated on main SPX card, absent on HELIX page | `SpxTradeAlerts.tsx:382` (gated), `FlowFeed.tsx` (none) |
| Marketing ↔ product accuracy | **Weak** (Q-1, Q-2, P-11) — onboarding teaches removed Hunt Modes; Heatmaps over-claims; "tick by tick" overstates | `onboarding-content.ts:78`, `Heatmap.tsx:7`, `FaqSection.tsx:75,84` |
| Public, verifiable proof | **Excellent (when data exists)** | `track-record-public.ts`, `/embed/track-record` |
| Premium-feel consistency | **Uneven** (P-10) | Night's Watch (polished) vs HELIX bespoke panels |

---

## F. Launch blockers (product/UX, for a 10→500 concurrent launch)

1. **Q-1 — Onboarding + landing teach "Hunt Modes" that the product removed.** The first-run experience promises a feature that isn't there and never introduces Night's Watch. Fix the copy (and delete/restore the dead agent components) before opening the funnel.
2. **Q-2 — Heatmaps is sold as sector/internals/tide but renders GEX only.** A concrete, falsifiable claim the product fails on one of five headline tools. Re-cut the marketing (fast) or restore the view (better).
3. **P-1 — Closing a position uses `window.prompt` on the money path.** Off-brand and *suppressible on the PWA/mobile the product sells*, meaning users can be unable to close a position. Replace with the existing Modal.
4. **P-2 — No free preview anywhere.** Not a correctness bug, but for a 500-user launch the funnel converts on the sales page alone; a throttled preview of one tool is the highest-ROI growth change and should land before scaling spend.

**Strongly recommended pre-scale (not strict blockers):** Q-3 (upgrade sigils silently missing), P-5 (disclaimer consistency on HELIX + all SPX phases), P-8 (push delivery is inert while marketed), P-3 (Largo citations).

---

## G. Method note / verification limits

- All copy/feature claims were checked against the rendering component (e.g. `Heatmap.tsx` renders only `GexHeatmap`; the 11-point checklist was counted in `spx-play-confirmations.ts` and matches the FAQ; the sigil label mismatch was confirmed by grepping both the map keys and `FEATURE_MATRIX`).
- Conversion/refund impact, push-delivery behavior in prod, SSE-vs-poll real cadence under load, and whether any free-preview exists at the edge are **product inferences from code**; the funnel/retention numbers themselves are **Not verified — need prod analytics**.
- This section deliberately does **not** re-litigate the UI-mechanics findings in `02-FRONTEND.md` (keyboard a11y on the tape, monolithic CSS, framer-motion cost) except where a defect is primarily a *trust/credibility* problem (P-1, P-10).
