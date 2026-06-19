# Re-Audit — Batch 04: Night Hawk

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 2 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-Night-Hawk.md`

---

## Prior fixes (re-verified)

| Item | Status | Evidence |
|------|--------|----------|
| Bug A — chain double fetch | ✅ **FIXED** | `claude-edition.ts` single `fetchEditionChains()` (unchanged) |
| Bug B — Jan rollover | ✅ **FIXED** | `option-chain-prompt.ts:284-290` (unchanged) |
| Skew double-count | ✅ **FIXED** | `scorer.ts` `skewAdj=0` on flip |
| Tech-null edition drop | ✅ **FIXED** | `edition-builder.ts:201-203` `d.scored != null` |
| Day Trade Agent wired | ✅ **FIXED** | `hunt/route.ts` → `runDayTradeAgent` |

---

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **M1** | ⚠️ **PARTIAL** | `hunt-mode.ts:67-108` + `hunt-builder.ts:60-82` — `dte_min`, `dte_max`, `require_catalyst` parsed and enforced in `dossierPassesPrefilters`. **`max_entry_premium` (swing UI field) not parsed or applied** — grep shows no handler |
| **M2** | ✅ **FIXED** | `hunt-builder.ts:162-163` — hunt filter uses `d.scored != null` (was `d.tech != null`); aligns with edition `edition-builder.ts:201-203` |
| **LM1** | ❌ **OPEN** | `day-trade-filters.ts:46-47` — ambiguous directions still pass SPX alignment when bias ≠ neutral |
| **L1** | ❌ **OPEN** | `embeds/NightHawkRadar.tsx` — cosmetic timer blips, no API |
| **L2** | ❌ **OPEN** | `day-trade-agent.ts` — `max_dte === 1` still lacks hard post-filter |
| **L3** | ❌ **OPEN** | `day-trade-filters.ts:81-82` — DTE uses local midnight, not ET |
| **L4** | ❌ **OPEN** | Day signal phases always `CANDIDATE` |
| **L5** | ❌ **OPEN** | `AgentPowerModal.tsx:138` — `key={play.ticker}` collision risk |
| **Step 3 expiry-less strike** | ❌ **OPEN** | `option-chain-prompt.ts:306-311` — validation without expiry still matches any front row |

---

## Key fix verification

### M1 — swing/leap filters (partial)

Server-side DTE window and leap catalyst toggle now wired:

```71:80:src/lib/nighthawk/hunt-builder.ts
  if (filters.dte_min != null || filters.dte_max != null) {
    const dtes = dossier.flows.map(flowDteDays).filter((d): d is number => d != null);
    // ...
  }
  if (filters.require_catalyst && !dossierHasCatalyst(dossier)) {
    return false;
  }
```

Swing **max entry premium** filter in `agent-config.ts` remains UI-only.

### M2 — hunt vs edition technical gate

```162:163:src/lib/nighthawk/hunt-builder.ts
    const dossierList = Object.values(dossiers).filter(
      (d) => d.scored != null && dossierPassesPrefilters(d, filters)
```

Flow-only candidates with null Polygon MTF can now appear in hunt results (scored from flow).

---

## 🆕 New findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| — | — | — | No new findings beyond original IDs |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 1 (M2) + 5 prior verified |
| ⚠️ PARTIAL | 1 (M1 — missing `max_entry_premium`) |
| ❌ OPEN | 7 (LM1, L1–L5, expiry-less edge) |
| 🆕 NEW | 0 |

**Recommended next:** Complete M1 (`max_entry_premium` post-Claude cap) → LM1 → L2/L3 DTE hardening.
