# SPX Playbook — External Review Response (ChatGPT, 2026-07-10)

**Source:** independent review of `PLAYBOOK-ARCHITECTURE-DEEP-DIVE.md`, `PLAYBOOK-FULL-SPEC-v2.md`, `PLAYBOOK-EVIDENCE-BASE.md`, `PLAYBOOK-E2E-FOUNDATION.md`.

**Official stance:** We **agree with the core verdict** — strong architecture, unproven strategy. Staging playbook lab is **research instrumentation**, not trusted autonomous production capital deployment.

---

## Scorecard (accepted as fair)

| Area | External score | Our position |
|------|----------------|--------------|
| Architecture | 8/10 | Agree — layered model, shadow rollout, attribution direction is correct |
| Strategy specification | 6/10 | Agree — static thresholds, MVP proxies, overlapping hypotheses |
| Evidence quality | 2/10 | Agree — n=19, all long, negative avg P&L is not validation |
| Production readiness | 3/10 | Agree for **prod autonomous BUY**; staging is deliberately research-grade |
| Potential | 8/10 | Agree if next phase is discipline, not catalog expansion |

**Most important takeaway (accepted verbatim):**

> Do not interpret architectural sophistication as evidence that the strategy works.

---

## What we already had right (no change needed)

1. **Confluence soup → named playbooks** — target BUY = setup + trigger + gates, not score alone.
2. **ARMED → TRIGGERED lifecycle** — documented as next foundation gap (state machine).
3. **Shadow-first + `playbook_id` telemetry** — staging accumulates prospective evidence before prod gate.
4. **NEEDS-FIELD transparency** — MVP matchers labeled `*spec*` in FULL-SPEC §3; not promoted as full thesis validation.
5. **Hybrid honesty** — docs state legacy engine still owns prod BUY until explicit `PLAYBOOK_LIVE_GATE=1`.

---

## Where we are changing course (adopted recommendations)

### 1. Promotion thresholds — too weak at n=10

**Old (deprecated):** ≥10 outcomes, WR≥45%, avg pnl>0 per playbook.

**New — progressive tiers:**

| Tier | Requirements | Unlocks |
|------|--------------|---------|
| **Research-qualified** | ≥30 triggers logged, ≥20 simulated executable trades; multiple win/loss days; multiple γ/vol regimes; no severe data-quality flags | Continue shadow + matcher tuning |
| **Staging-qualified** | ≥50–75 prospective trades; positive expectancy after spread/slippage model; stable across ≥2 temporal segments | Staging lab may open **that PB** (starter only) |
| **Limited-live (prod)** | Paper-live or min-size live; daily/weekly loss limits; rollback switch; per-trade option quote reconciliation | Prod `PLAYBOOK_LIVE_GATE` per-PB allowlist |

Win rate alone is insufficient — track **expectancy, profit factor, MAE/MFE tails, MFE capture %, cost-adjusted option P&L**.

### 2. Initial serious validation set — shrink live surface

**Staging lab / future prod allowlist (first wave):**

| PB | Rationale |
|----|-----------|
| PB-01 | VWAP Reclaim — core trend/recovery |
| PB-02 | VWAP Reject — **short-side audit** counterpart |
| PB-03 | ORB — opening structure (effective window ~09:50–10:30, see doc fixes) |
| PB-04 | Gamma Pin Fade — strongest evidence-backed hypothesis |
| PB-14 | Failed Breakout — promising; requires state machine before live |

**Sixth when prospective n sufficient:** PB-08 Power Hour.

**Shadow-only until NEEDS-FIELD or evidence closed:** PB-05, PB-07, PB-09, PB-10, PB-11, PB-12, PB-13.

*Implementation follow-up:* `PLAYBOOK_LIVE_ALLOWLIST` env (staging + prod) to enforce this at gate A17 — not yet coded; policy documented now.

### 3. Unknown regime — fail closed for **live entry only**

| Mode | Unknown regime |
|------|----------------|
| Shadow / UI | Fail-open (current) — record telemetry when EMA regime missing |
| Live BUY | **Fail-closed** (target) — block new entries unless PB is proven regime-agnostic |

### 4. Two outcome layers (required before prod trust)

| Layer | Fields |
|-------|--------|
| **Underlying** | SPX MFE/MAE, stop/target hit timestamps, thesis break |
| **Option trade** | Contract, quote at decision, spread, assumed fill, option MFE/MAE, fees/slippage |

SPX-point P&L alone does not prove tradable edge.

### 5. Short-side pipeline audit (P0 research)

Log and dashboard:

- `eligible_long` / `eligible_short`
- `armed_long` / `armed_short`
- `triggered_long` / `triggered_short`
- `blocked_long` / `blocked_short`
- `opened_long` / `opened_short`

All 19 prod trades were long — treat as **potential implementation defect** until explained.

### 6. Build order (revised — architecture before catalog)

| Priority | Item |
|----------|------|
| P0 | Persistent playbook state machine + `instance_id` |
| P0 | Per-instance telemetry (armed/triggered/invalidated/blocked reasons + feature snapshot) |
| P0 | Short-side pipeline audit |
| P1 | Option-contract execution simulator (spread/slippage) |
| P1 | Data-quality degraded mode (block event/breakout PBs on stale feeds) |
| P1 | Gate category split: operational / risk / playbook-validity / quality |
| P2 | Playbook-specific exit management |
| P2 | Session-level risk governor (max trades, daily loss, one thesis, kill switch) |
| P3 | Evidence-aware primary ranking (static priority = tie-breaker only) |

**Explicitly deprioritized:** expanding beyond 14 playbooks; promoting MVP matchers to trusted live.

---

## Playbook-specific notes (accepted / deferred)

| PB | External concern | Action |
|----|------------------|--------|
| PB-01 | Pre too permissive; 13:00–14:00 weak band | Tighten pre in matcher experiment; document 13:00 cutoff as hypothesis |
| PB-02 | Flow materiality threshold | Add normalized flow persistence threshold in matcher v2 |
| PB-03 | Doc says 09:35 but OR gate → ~09:50 | **Doc fix** — effective executable window |
| PB-04 | Wall quality, interior target | Research: wall magnitude/freshness; target mid not always opposite wall |
| PB-05 | Not production-ready | Shadow-only (already MVP tier) |
| PB-06 | Flip as zone not line | Research |
| PB-07 | Weak standalone | Shadow-only; use as target modifier first |
| PB-08 | n=4 positive band insufficient | Staging shadow; sixth in allowlist when n grows |
| PB-09 | Modifier not standalone | Rank as confirmation layer first |
| PB-10 | VWAP proxy for EMA stack wrong | NEEDS-FIELD — shadow only |
| PB-11 | HOD–LOD ≠ 30m range | NEEDS-FIELD rolling range |
| PB-12 | High tail risk | Shadow-only or remove from launch set |
| PB-13 | Gap size alone insufficient | Shadow-only |
| PB-14 | Needs break memory + state machine | Allowlist member but **no live until state machine ships** |

---

## Documentation inconsistencies — fixes applied

See `PLAYBOOK-FULL-SPEC-v2.md` §3 PB-03 note, `PLAYBOOK-ARCHITECTURE-DEEP-DIVE.md` §11, and promotion §7 updates in same PR/commit.

| Issue | Resolution |
|-------|------------|
| PB-03 window 09:35 vs 09:50 | Document **effective BUY window ~09:50–10:30** (OR_MINUTES=20 + gate A11) |
| E2E registry-order vs priority list | E2E updated: explicit `PRIMARY_PRIORITY` in matcher, not registry order |
| PB-01 regime matrix vs diagram | Matrix in `playbook-regime-router.ts` is source of truth |
| PB-01 ends 14:00 vs 13:00 weak band | Keep 14:00; flag **13:00 experimental cutoff** in evidence doc |
| Checklist vs macro hard block windows | UI must label hard block vs soft quality (documented in FULL-SPEC §6) |

**Long-term:** generate matrices/diagrams from typed registry to prevent drift.

---

## Staging policy (unchanged, clarified for reviewers)

`staging.blackouttrades.com` **always** runs playbook lab — hardwired `isStagingDeploy()`. This is **prospective research**, not “trusted autonomous production.” Prod remains legacy BUY until per-PB limited-live qualification.

---

## Decision log

| Decision | Status |
|----------|--------|
| Continue platform build | ✅ |
| Prod trusted autonomous entries | ❌ not until tiers above met |
| Staging shadow + lab | ✅ always on |
| Expand playbook catalog | ❌ freeze at 14 |
| Next engineering focus | State machine + telemetry + short audit + option sim |

---

*Review captured 2026-07-10. Revisit after each RTH week when `spx_playbook_shadow_observations` sample grows.*
