# ui-enhancement-audit — 2026-06-26 (Sun)

Run start: 2026-06-26 ~09:07 PT. First run of SDLC section 8 (ui-enhancement-audit).
Repo: `C:/Users/raidu/blackout-cron` (isolated cron clone). Bridge: Chrome (blackouttrades.com), admin.

Method: AGGRESSIVE deep pass — a 6-agent code-grounded design audit workflow (`ui-enhancement-deep-pass`,
53 agents incl. per-finding adversarial verify, 472 tool uses, ~20 min) over 6 disjoint sub-dimensions
(responsive/mobile, visual-consistency, micro-interactions, VITALS motion #81, empty/loading states,
design-system adoption), **plus** live Chrome ground-truth checks (computed-color grey scan + tap-target
sizing on `/`, `/dashboard`, `/heatmap`). 47 raw findings → **42 confirmed** after verification.

FIX-vs-FLAG: design is a product call → trivial token/contrast/motion-token swaps fixed → main; everything
design-altering branched/flagged (TaskCreate #1–#8) for human review. No design auto-pushed to main.

---

## Live ground-truth (Chrome bridge) — all PASS
- **Grey enforcement holds.** Computed-style scan (low-saturation grey AND low-alpha-white body copy) on
  `/`, `/dashboard`, `/heatmap` → **0 violations**. Source grep also clean: `text-(zinc|neutral|gray|grey|slate|stone)-*`,
  `bg-`/`border-`grey, and `text-white/10..40` body copy all **0**. The no-grey rule is fully enforced.
- **Tap targets (desktop render):** only sub-36px interactive element on `/dashboard` is the 1×1 "Skip to
  content" a11y skip link (intentional, positive). True mobile-viewport emulation NOT possible via the bridge
  (fixed 2560px render surface; window resize can't shrink the layout viewport) → mobile sizing audited from source.

---

## ✅ FIXED → main (commit `5eab22b`, 19 files; tsc + next build green)
Trivially-safe, behavior-neutral. The guardrail explicitly permits token/spacing/**contrast** fixes direct-to-main.

**Token hygiene (exact-equivalent, zero visual change):**
- `Stat.tsx:84`, `Table.tsx:123`: `text-[#9fb4d4]` → `text-mute` (DS primitives now reference the token, not raw hex)
- `AdminNightHawkDashboard.tsx:159`: `bg-[#9fb4d4]` → `bg-mute`
- `Panel.tsx:12,21`: ember accent `border-[#ff6b2b]/30`→`border-ember/30`, `via-[#ff6b2b]`→`via-ember`
- `offline/page.tsx:11`: `bg-[#040407]` → `bg-void`
- `globals.css`: 7× literal `cubic-bezier(0.22,1,0.36,1)` → `var(--ease-draw)`; 1× `…(0.34,1.56,0.64,1)` → `var(--ease-snap)` (One-Clock token adoption)

**AA-contrast (documented brand rule: small/inline bear = `bear-text` #ff5c78, not display `bear` #ff2d55 ~4:1):**
- `LiveFlowTape.tsx:53`, `SplitFlowRadar.tsx:154`, `NetPremiumLeaderboard.tsx:76`, `DarkPoolPanel.tsx:347` (EmptyState title): small `text-bear` → `text-bear-text`
- `VelocityRadar.tsx:141`, `NightHawkFlowPanel.tsx:189`, `SplitFlowRadar.tsx:168`: footnote `text-sky-500` → `text-sky-300/70`
- `FaqSection.tsx:194` (`text-white/70`), `LandingFooter.tsx:169` (`text-white/60`): dim-white body copy → `text-secondary` (~9:1 AA)
- route-state CTA ink `error.tsx:41`/`not-found.tsx:28`/`offline:29`: `text-black` → `text-[#021c14]` (matches Button primary ink)

**Semantic + motion alignment:**
- `PlaybookBoard.tsx`: "Awaiting close" `Badge tone="bear"` → `tone="sky"` (pending state was masquerading as an error in bear-red)
- `Tabs.tsx:298` per-tab recolor `duration-150` → `duration-base`; `globals.css` `.admin-action-btn` `duration-200` → `duration-base` (sync with VITALS rail/One-Clock)

Deferred from the auto-fix set (correctly): inline `style={{color:"#ff2d55"}}` arrows in DarkPoolPanel/SectorFlowPanel/
GexHeatmap carry `textShadow` glows / are 14px font-black — styled elements, not plain small text → folded into the
inline-hex proposal (Task #8) rather than blind-swapped.

---

## ⚠️ FLAGGED proposals (branch + human review) — TaskCreate #1–#8
Design/layout/product calls; not auto-pushed.

| # | Sev | Proposal |
|---|---|---|
| 1 | P1 | **NetPremiumLeaderboard perpetual fake-loading** — empty tape renders never-resolving skeletons (no `loading` prop); thread loading/hasData from FlowFeed → EmptyState. |
| 2 | P1 | **`.admin-table` + `.flow-*` parallel CSS systems** duplicate Table/Badge with off-brand tokens (incl. a magenta `rgba(217,70,239)` that is NOT brand purple); migrate + delete bespoke CSS. |
| 3 | P2 | **VITALS Phase 2 (#81):** `Stat` has no value-change animation — live numbers swap silently. Add opt-in `flashOnChange` value-tick (the highest-leverage motion enhancement). |
| 4 | P2 | **One Clock cadence:** `circuit-drift` (`--pulse-period-slow` never published) + `.platform-ambient-*` (hardcoded `8s ease-in-out`) don't subscribe to the live market heartbeat → backdrops drift out of phase. |
| 5 | P2 | **Off-brand orange** (`#fb923c`/orange-300..950) themes VelocityRadar + SpxSniperHeader pills + SpxTradeAlerts; remap to gold/ember or tokenize a documented warm. |
| 6 | P2 | **No Segment/ToggleGroup primitive** — filter-pill idiom hand-rolled 3× across FlowFeed + GexHeatmap; extract a shared primitive. |
| 7 | P2 | **Mobile** — FlowFeed toolbar sub-44px tap targets (replay-speed pills ~16px) + pervasive `text-[9px]` labels below the 10px DS floor (Night's Watch panels/modal, GexHeatmap dividers). |
| 8 | P2 | **No canonical glass-surface token** — 6+ divergent near-black card fills (Stat 0.5 vs Card/Panel 0.6 alpha) + Card/Stat radius mismatch; route primitives through one token. Folds in inline-hex→token map. |

### Smaller proposals (logged; fold into the batches above)
- Route-state pages (error/not-found/offline) use a bespoke pill CTA (rounded-full, mono-uppercase, text-black) = a 3rd button language vs the `<Button>` primitive (rounded-xl, #021c14, emerald-sweep). Migrate to `<Button>` or add `shape="pill"`. (→ relates #2/#8)
- `DayTradeAgentWorkspace.tsx` hand-rolls a `role=dialog` shell (uses `useFocusTrap` but not `<Modal>`); peers AgentPowerModal/PlayDetailModal use `<Modal>`. Full-bleed takeover, so factor a full-bleed Modal variant. (P2)
- `GexHeatmap.tsx:1574-1771` bespoke combobox/listbox; no `Select`/`Combobox` primitive exists. (P3)
- `NightsWatchPanel.tsx:1108` add-position form mounts/unmounts with no AnimatePresence collapse while siblings animate. (P2)
- `PlanLadder.tsx:53` checkout CTA: no active-press/branded focus-ring, hardcoded duration-200. (P3)
- nav-pill/signin/join lack a branded `:focus-visible` ring (fall back to generic sky outline; `.nav-card` has the branded ring). Borderline-trivial → flagged to avoid a design call. (P3)
- Lazy-import loaders render blank `<div>`/`null` instead of Skeleton (`FlowsEmbeds.tsx:11`, `DarkPoolPanel.tsx:13`) → layout flash. (P3)
- `SpxTrackRecordPanel.tsx:51` inline-`<p>` empty state vs the EmptyState primitive (compact panel — defensible). (P3)
- `ProductMark` `.is-live` is a one-shot scroll-in draw, not bound to live feed freshness — Phase 2 "live-state breathing" gap. (P3)
- Dead `--dur-ambient` token (globals.css:43, 0 consumers) + duplicate sigil-block easing redefinitions (11312-15) — CSS hygiene; fold into #4.

---

## Notes / caveats (self-critique)
- The verify pass caught real false-positives in the raw findings (e.g. "admin is the lone raw-`<table>` holdout" — GexHeatmap also has one; the Segment finding's TickerDrawer/FlowAlertStream cites are star-toggles, not filter pills). Those corrections are baked into the task descriptions above.
- Contrast swaps change a visible color slightly but strictly toward the **documented** brand AA tokens (bear-text/secondary/sky-300) that the DS already establishes — high-confidence, low-risk.
- Mobile responsiveness was audited from source only (bridge can't emulate a phone viewport) — Task #7 items need a real-device/devtools pass before implementing.
- Concurrency: committed only my `src/` files (left the concurrent railway-monitor-log untouched); rebased onto `origin/main` (autostash) before pushing; merged tree re-typechecked green.
