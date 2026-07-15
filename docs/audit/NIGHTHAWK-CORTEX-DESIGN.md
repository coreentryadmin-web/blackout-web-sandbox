# Night Hawk Cortex — one brain for 0DTE (design + per-source debate)

**Date:** 2026-07-13 · **Directive:** "integrate Thermal, Helix, Vector and BIE into Night Hawk —
it should know everything… question, debate every integration, every data source."
**Builds on:** `NIGHTHAWK-0DTE-DECISION.md` (gate spec G-1..G-7, in build tonight) and
`NIGHTHAWK-VS-SLAYER-0DTE.md` (v1 architecture audit).

---

## 0. The design decision

**Do NOT scatter per-tool integrations into the 0DTE scanner.** Every tool bolted directly into
`scan.ts` becomes an unowned dependency knot (the v1 audit found exactly this disease: four 0DTE
surfaces, three risk cultures). Instead, build **one evidence composer — the Cortex**:

```
composeCortexEvidence(ticker, direction, nowEt) → CortexVerdict
```

- One server-side module (`src/lib/nighthawk/cortex/`), consumed identically by 0DTE Command,
  the Night Hawk edition builder, the hunt UI, and BIE (which already answers "is 7500 0DTE good
  today" — the Cortex becomes the shared implementation of that question).
- Every platform data source contributes an **EvidenceItem**: `{source, stance: supports|opposes|
  veto|absent, weight, halfLifeSec, asOf, detail}` — signed, bounded, timestamped.
- **Veto asymmetry (the precision-first principle):** any source may VETO (hard block, logged),
  but supporting evidence is capped per source (max +N). One loud bullish signal can never buy an
  entry; one loud bearish fact can kill it. This is how "best plays only" is enforced structurally.
- **Evidence decay:** each item decays by its half-life; the composite is recomputed from live
  `asOf` stamps. Stale evidence self-silences (the platform's stale-honesty rule, applied to alpha).
- **Absence is signal-neutral, never fabricated:** a source that can't answer contributes
  `absent` — visible in the verdict, worth zero. No nulls dressed as neutrality.

The Cortex verdict feeds the (already-in-build) gate stack as **one more gate input + a score
modifier**, and its full evidence vector is persisted per play (rides the `entry_context` work) —
see §3 "the calibration loop", which is the actual long-game breakthrough.

---

## 1. The per-source debate (what each adds, when it lies, how 0DTE uses it)

### Vector GEX ladder — walls, king nodes, flip, max pain (0DTE horizon)
- **Adds:** the dealer landscape the trade must traverse. A long into a dominant call wall inside
  the expected move is buying into a sell-hedging zone; a bounce off a defended put wall with the
  king node above is structurally supported. Regime (spot vs flip) sets the *style*: long-gamma
  tape mean-reverts (fade edges), short-gamma trends (momentum follows).
- **Lies when:** OI-derived walls are stale intraday (why walls use OI+dayVolume post-a63f162);
  one-sided thin chains (TSLA 0DTE Tuesdays) fabricate geometry — the honest-gap rule carries over.
- **0DTE use:** `wallPathCheck` — BLOCK if the play's target path crosses an opposing dominant wall
  within 0.5× expected move; SUPPORT if entering off a same-side wall ≤0.25× EM behind entry.
  Regime-style mismatch (momentum play in long-gamma pin tape) = oppose, not veto (calibrate first).

### Vector bead HISTORY — wall lifecycle (UNIQUE TO US)
- **Adds:** nobody else has intraday wall *history*. A wall's strength TREND is more predictive
  than its level: trading toward a **fading** wall (beads dimming over the last 30–60 min) is
  path-clearing; toward a **building** wall is path-hardening. King-node migration direction is a
  dealer-intent vector.
- **Lies when:** recorder gaps (off-hours, viewer-less names pre-dynamic-universe) — require ≥N
  samples in the trend window before speaking.
- **0DTE use:** `wallTrendFactor` — supports/opposes by opposing-wall strength slope; king-node
  migration toward the target = support. This is the flagship differentiator; ship it early.

### VEX / DEX / charm
- **Adds:** vanna/charm flows dominate expiry afternoons: charm decay accelerates pin behavior
  into the close; VEX says whether vol moves help or hurt dealers (and thus whether IV crush fights
  the play). Long premium in a charm-pinned tape after ~14:30 bleeds even when "right."
- **Lies when:** second-order greeks from sparse chains are noise; our charm lens is NOT built yet
  (task #24) — **debate verdict: integrate VEX now (lens exists), model charm as a time-of-day ×
  pin-distance heuristic until real charm ships.** No fake charm numbers.
- **0DTE use:** afternoon long-premium plays within 0.3× EM of the king node → oppose (pin risk);
  VEX-supportive vol direction → small support.

### Helix — flow prints, sweeps, blocks
- **Adds:** the *quality* of the flow behind a setup. 0DTE Command already keys on flow aggregates;
  Helix adds print-level texture: sweep clusters (urgency) vs block prints (negotiated, often
  hedges) vs splits. Opposing whale prints after commit are an exit accelerant.
- **Lies when:** flow direction ≠ intent (hedges, rolls, spreads legs read as naked aggression).
  Single-print conviction is a trap — only clusters count.
- **0DTE use:** `flowQuality` — sweep-cluster alignment supports; opposing block/sweep cluster
  ≥$1M within 15 min = veto-grade for NEW commits, exit-signal for open ones.

### Thermal — sector/breadth heat
- **Adds:** the room the ticker trades in. A long whose sector row is deep red is fighting its
  peers; market internals (TICK/ADD already on the Slayer desk) say whether ANY long has tape
  support. Cheap, orthogonal, honest.
- **Lies when:** idiosyncratic names (biotech FDA, single-stock news) legitimately decouple.
- **0DTE use:** sector-heat alignment = support/oppose; catalyst-tagged names (see news) exempt
  from the sector opposition (the decoupling is the thesis).

### BIE — the synthesis brain + news/earnings/catalysts
- **Adds:** BIE already runs deterministic composers over the whole ecosystem
  (`fetchEcosystemContext`, `assembleEcosystemArsenal`, the ticker-verdict engine). The Cortex
  should USE those readers, not re-implement them — BIE and Cortex converge on one implementation
  of "what does the platform think about X right now."
  News/catalysts (Benzinga-via-Polygon): **flow + catalyst = informed; flow − catalyst = possibly
  hedge noise** — the single best discriminator for "why is this flowing."
- **Lies when:** headline sentiment is naive (guidance cut "beats" lowered bar); catalyst
  timestamps drift. Deterministic keyword/channel tagging only — no LLM in the money path.
- **0DTE use:** catalyst-confirmed flow upgrades conviction one band; **earnings-today (AMC) on
  the ticker → oppose long-premium commits** (IV-inflated premium, event risk beyond expiry
  window); macro hard-block windows already in G-7.

### Dark pool levels
- **Adds:** institutional reference levels; confluence with walls = stronger S/R.
- **Lies when:** prints are stale or venue-skewed; levels without size context are decoration.
- **0DTE use:** confluence bonus only (never standalone): wall + dark-pool level within 0.1× EM
  of each other strengthens the wallPathCheck verdict.

### SPX Slayer desk — market regime (already G-1's source)
- Already the bias/veto source for the gate stack. Cortex consumes the same desk snapshot (one
  source of truth, no second derivation). Nothing new to build; listed for completeness.

---

## 2. The verdict, concretely

```ts
type CortexVerdict = {
  ticker: string; direction: "long" | "short"; asOf: string;
  vetoes: EvidenceItem[];          // any non-empty → gate stack blocks the commit
  score: number;                   // bounded sum of decayed, capped contributions
  supports: EvidenceItem[]; opposes: EvidenceItem[]; absent: string[];
  conviction: "A" | "B" | "C";     // display capped at A while the A+ inversion is open (C-1)
  narrative: string[];             // deterministic member-facing “why” lines (BIE voice rules:
                                   // every number traces to an input — the Largo guard-test
                                   // pattern applies here too)
};
```

Wiring: the gate stack (G-1..G-7) runs first (cheap, fail-closed); Cortex runs on survivors;
vetoes block; score modifies the commit floor (a G-3-passing setup with net-negative Cortex
evidence still doesn't print). Member UI shows the full evidence table on every card — including
SKIPs. **The system's edge is argued in public, play by play.**

---

## 3. The breakthroughs (out-of-the-box, in priority order)

1. **The calibration loop — the system grades its own beliefs.** Persist the entire evidence
   vector on every commit AND every skip (extends `entry_context`). After every graded session, a
   nightly job recomputes per-source hit rates (did wallTrendFactor's supports actually win?).
   Weights become *earned*, published in the admin calibration report, and adjusted by data — not
   by vibes. This converts every trading day into training data for the composer. No other retail
   system self-audits per-factor.
2. **Counterfactual ledger — grade the SKIPs.** `zerodte_scan_rejections` rows get the same
   outcome grading as commits (what WOULD the plan have done?). Now both error types are measured:
   losers printed AND winners skipped. The gate stack's opportunity cost stops being invisible —
   and gate thresholds (10:30 window, floor 65) get tuned from evidence on both sides.
3. **Wall-trend factor** (§1, bead history) — the flagship unique signal; ship in v1 of Cortex.
4. **Evidence half-life** — alpha that expires; no stale conviction anywhere in the money path.
5. **One brain, three mouths** — Cortex verdicts consumed by 0DTE Command (trade), Largo/BIE
   (narrate), Night Hawk edition (evening context) — the platform stops disagreeing with itself
   (the flip-coherence class of bug becomes structurally impossible for play logic).

**Honesty clause (standing):** none of this promises 100% winners. The Cortex maximizes selectivity
and expectancy: with the −50/+100 payoff, breakeven is 33% WR; the machinery above is how the
win rate earns its way toward 55–65% and STAYS honest (every factor graded, every skip graded).

---

## 4. Build plan (conflict-aware — two agents already own zerodte gate/accountability files)

- **PR-A (now): Cortex core, NEW FILES ONLY** — `src/lib/nighthawk/cortex/{types,compose,sources/*,
  narrative}.ts` + tests with fixture snapshots per source (including a 7/13 QQQ-short fixture that
  must come out net-supportive and a SPY-long fixture that must veto). Reads via the EXISTING
  composers (`fetchEcosystemContext`, vector wall/history readers, desk snapshot, helix/thermal
  readers, polygon-news, uw-darkpool-levels). Zero edits to scan.ts/board.ts.
- **PR-B (after gates+accountability land): wire-in** — gate-stack hook (vetoes + score modifier),
  evidence vector into `entry_context`, SKIP-card evidence rendering. Small diff, owned by whoever
  merges last.
- **PR-C: calibration loop + counterfactual grading** — nightly per-source hit-rate job + admin
  report section + rejection-row grading (reuses the plan grader on rejected plans).
- **PR-D: UI** — the Night Hawk 0DTE pane (cards with evidence tables, governor strip, record
  with LOW-N badges) — already queued as the UI phase of tonight's build.
