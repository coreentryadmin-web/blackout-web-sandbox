# Audit — Night Hawk (status carried from prior deep audits)

Night Hawk (`lib/nighthawk/**`) was deep-audited line-by-line across several
prior sessions. Batch 04 forensic audit (2026-06-19) re-read all 48 plan files
including `agents/**`. Full report: `audits/AUDIT-Night-Hawk.md`.

## Resolved & verified
- Skew double-count (scorer) — fixed (directionFlippedBySkew → skewAdj=0)
- Cross-process rate limit — Redis global RPS cap added (uw-rate-limiter)
- Critic stub backfill → publishes fewer strong plays + unvetted floor
- Tech-null no longer drops candidates (filter = `d.scored != null`)
- Outcome resolver bias — target now uses intraday high/low (symmetric w/ stop)
- Critic zero-play floor — top-2 unvetted fallback
- `rel_volume` dead → wired (provider polygon-largo.ts:277 → technicals.ts:120)
- `swingLevels` dead → fed real `daily_bars` (60 bars, lookback 45)
- SPX/VIX 2-bar range → `priorEtYmd(45)`
- Flow capped at 200 → paginates to 450
- Hard strike validation added (validatePlayAgainstChain)
- Null premium now rejected
- Holiday calendar added (US_MARKET_HOLIDAYS)
- ✅ **Bug A: option chains fetched twice** — **FIXED** (`fetchEditionChains` + `formatEditionChainTables`; single fetch per ticker)
- ✅ **Bug B: year rollover rejects January plays in late December** — **FIXED** (`option-chain-prompt.ts:287-289` rolls to `year + 1` when >5 days past)
- Day Trade Agent — **WIRED** (`runDayTradeAgent`, hunt route day branch, `DayTradeAgentWorkspace`)

## 🟠 OPEN — from Batch 04 audit (see `audits/AUDIT-Night-Hawk.md`)

| ID | Sev | Issue |
|----|-----|-------|
| M1 | 🟠 | Swing/leap UI filters (`dte_min`/`dte_max`/`max_entry_premium`/`min_dte`/`require_catalyst`) not applied in `normalizeHuntFilters` |
| M2 | 🟠 | Hunt requires `tech != null`; edition uses `scored != null` — flow-only names in playbook but excluded from hunt |
| LM1 | 🟡 | SPX alignment passes ambiguous/non-short/non-long directions when bias is bull/bear |
| L1–L5 | 🟡 | Embed radar cosmetic; 0–1 DTE post-filter gap; ET DTE date; phase lifecycle stub; modal duplicate keys |
| L6 | 🟡 | Expiry-less `options_play` may validate against wrong front expiry OI |

## Status: healthy core pipeline. Prior Bugs A/B closed. Remaining work is hunt-agent filter wiring + alignment edge cases.
