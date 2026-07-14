# Comprehensive Test Roadmap — Scenario Engine Validation (2026-07-14)

**Status**: Tests prepared and ready; awaiting staging deployment of #340 (scenario engine)

---

## Test Suite Overview

### 1. **Local Validation** ✅ (ALL PASS)
- **Script**: `scripts/validate-all-scenarios.mjs`
- **Coverage**: 21 validations across shift parsing, regime calculation, distance math
- **Result**: 21/21 pass (100%) — scenario engine logic verified locally
- **Run**: `node scripts/validate-all-scenarios.mjs`

### 2. **Staging API Validation** ⏳ (Ready to deploy)
- **Script**: `/tmp/.../staging-scenario-test.sh`
- **Coverage**: 
  - 23 scenario test cases
  - 4 scenario types: drop (%), rip (%), points, absolute price
  - 6 DTEs/timeframes: WEEKLY/MONTHLY/0DTE × 1H/5m/15m
  - 8 universe stocks: SPX, SPY, NVDA, QQQ, AAPL, TSLA, IWM, GLD
  - 7 non-universe stocks: RKLB, UBER, PLTR, RIOT, SOFI, HOOD, ASTS
- **Expected**: ≥95% pass rate (all scenarios available, numerical data present, keywords matched)
- **Run**: `VALIDATE_BASE=https://blackout-web-staging.vercel.app bash staging-scenario-test.sh`

### 3. **Vector UI Validation** ⏳ (Ready to deploy)
- **Script**: `scripts/validate-vector-ui.mjs`
- **Coverage**: 
  - 7 stocks × 4 scenarios = 28 UI interactions
  - Tests: scenario input, data rendering, error handling
  - Universe stocks: SPX, SPY, NVDA, QQQ
  - Non-universe stocks: RKLB, UBER, PLTR
- **Expected**: ≥90% pass rate (UI renders numbers, no console errors, no "unavailable" messages)
- **Run**: `VALIDATE_BASE=https://blackout-web-staging.vercel.app npx tsx scripts/validate-vector-ui.mjs`

---

## Test Dimensions

### Stocks (15 Total)
| Type | Tickers | Data Path |
|------|---------|-----------|
| Universe | SPX, SPY, NVDA, AAPL, TSLA, QQQ, IWM, GLD | Recorded (real-time) |
| Non-Universe | RKLB, UBER, PLTR, RIOT, SOFI, HOOD, ASTS | On-demand fallback |

### Scenario Types (4)
1. **Drop (%)**: "if {stock} drops 1%" → regime flip, cross detection
2. **Rip (%)**: "what if {stock} rips 2%" → wall proximity, max pain
3. **Points**: "suppose {stock} breaks down 40 points" → structural level impact
4. **Absolute**: "if {stock} goes to 380 at open" → distance calculation

### DTEs (3)
- **0DTE**: Front expiry, tight bands
- **WEEKLY**: Standard horizon
- **MONTHLY**: Far OTM, wide bands

### Timeframes (5)
- **1m, 5m, 15m, 1H, 4H**: Tick to swing-trade resolution

### Data Validation (All Responses)
- **Numerical Format**: `{{ numbers }}` or `number%` / `number pts`
- **Keywords**: Regime, flip, wall, max pain, distance, support, CROSSES, PIERCED
- **Magnitude**: Points, percentages, price levels grounded in `knownVectorNumbers`

---

## Execution Sequence

### Phase 1: Await Staging Deployment (NOW)
✅ **Local validation**: 21/21 pass  
⏳ **Next**: Monitor staging deployment of #340 (merged at 654c615)

### Phase 2: Staging Endpoint Tests (When deployed)
- Run: `VALIDATE_BASE=https://blackout-web-staging.vercel.app bash staging-scenario-test.sh`
- Target: ≥95% pass rate
- Timeout: 5 minutes
- Failure recovery: Check Railway logs; isolate by stock/scenario; re-run

### Phase 3: Vector UI Tests (After Phase 2)
- Run: `VALIDATE_BASE=https://blackout-web-staging.vercel.app npx tsx scripts/validate-vector-ui.mjs`
- Target: ≥90% pass rate
- Duration: ~10 minutes
- Captures: Screenshots of each stock/scenario for diagnostics

### Phase 4: Morning Gates (2026-07-15 13:00-14:05 UTC)
- **13:00**: RTH warm-up (`npm run validate:deploy`)
- **13:20**: Deploy freeze (no pushes)
- **13:32**: Data-correctness audit (`node scripts/audit/data-validator.mjs`)
- **14:05+**: Post-open scenario re-validation on staging

---

## Success Criteria

| Metric | Target | Severity |
|--------|--------|----------|
| Local validation | 100% | Must-have |
| Staging API tests | ≥95% | Must-have |
| Vector UI tests | ≥90% | Should-have |
| Numerical data present | 100% | Must-have |
| Keywords matched | ≥80% | Should-have |
| Response time | <2s | Should-have |
| No "unavailable" | 0% | Must-have |

---

## Files & Locations

### Test Scripts
```
scripts/validate-all-scenarios.mjs            [Local, no API]
staging-scenario-test.sh                      [Staging endpoint tests]
scripts/validate-vector-ui.mjs                [UI E2E with Playwright]
```

### Documentation
```
docs/audit/TEST-ROADMAP-2026-07-14.md         [This file]
docs/audit/LOOP-STATUS-2026-07-14.md          [Autonomous loop status]
docs/audit/BASELINE-2026-07-01.md             [Pre-open baseline]
docs/audit/FINDINGS.md                        [Living issue log]
```

### Staging Test Results (After Runs)
```
audit-output/staging-scenario-<timestamp>.log
audit-output/vector-ui-<timestamp>.log
audit-output/vector-*.png                     [Screenshots]
```

---

## Deployment Dependencies

✅ **#340 Merged** (654c615 on 2026-07-14)
- Scenario engine core logic
- Shift parsing: %, points, absolute, structural levels
- Regime recomputation at shifted spot
- Cross-flip detection

⏳ **Staging Deployment**
- Latest: Staging hasn't deployed #340 yet (tested 20:24 UTC, got 404)
- ETA: Within 1-2 hours of merge
- Monitor: Run staging tests as soon as deployment confirms

❌ **L4d/L4e Defects** (Not blocking gates)
- PR #365 has architectural blocker (588 file diff, history divergence)
- Not included in staging deployment yet
- Noted for architectural review post-gates

---

## Running Tests Manually

### Before Staging Deployed (Local Only)
```bash
# Validate scenario engine logic locally
node scripts/validate-all-scenarios.mjs

# Expected: 100% pass (21/21 tests)
```

### After Staging Deployed
```bash
# Quick staging validation (8 key tests)
VALIDATE_BASE=https://blackout-web-staging.vercel.app \
bash staging-scenario-test.sh

# Comprehensive Vector UI tests
VALIDATE_BASE=https://blackout-web-staging.vercel.app \
npx tsx scripts/validate-vector-ui.mjs

# Full validation suite (orchestrated)
npm run validate:scenarios:full
```

---

## Integration with Morning Gates

| Time UTC | Gate | Test | Expected |
|----------|------|------|----------|
| 13:00 | RTH warm-up | `npm run validate:deploy` | All green |
| 13:20 | Deploy freeze | — | No pushes until 14:05 |
| 13:32 | Data-correctness | `node scripts/audit/data-validator.mjs` | Prices vs Polygon ✓ |
| 14:05+ | Post-open | Staging scenario tests | ≥95% pass |

---

## Failure Recovery

### Staging endpoint test fails (HTTP error or timeout)
1. Check deployment status: `curl -s $STAGING_BASE/api/health`
2. Check Railway logs: Recent deploy success?
3. If deploy succeeded: file bug with test evidence
4. If deploy pending: wait for completion, re-run

### Scenario returns "unavailable"
1. Confirm deployment includes #340 (354c615)
2. Check BIE route is live: `curl -s $STAGING_BASE/api/bie/largo-route -X OPTIONS`
3. If stock is non-universe: confirm on-demand fallback is wired
4. File bug: "Scenario unavailable for {stock}"

### Vector UI test hangs or crashes
1. Check Playwright: `npx playwright --version`
2. Check staging availability: Manual browser test
3. Isolate: Run single stock in isolation
4. File bug: Environment + error log

---

## Next Actions

### Immediate (Next Hour)
- [ ] Monitor staging deployment status
- [ ] Run staging scenario tests once #340 deployed
- [ ] Capture results to `audit-output/`

### Before Morning (Tonight)
- [ ] Verify all test scripts are executable
- [ ] Run local validation one more time
- [ ] Confirm staging deployment completed

### During Morning Gates (2026-07-15)
- [ ] 13:32: Run data-correctness audit
- [ ] 14:05+: Re-fire scenario tests on live staging
- [ ] Document results to `docs/audit/RESULTS-2026-07-15.md`

---

## Test History

| Date | Test | Result | Commit | Notes |
|------|------|--------|--------|-------|
| 2026-07-14 | Local validation | ✅ 21/21 | pending | Scenario engine logic verified |
| 2026-07-14 | Staging endpoint | ⏳ Pending | N/A | Awaiting #340 deployment |
| 2026-07-14 | Vector UI | ⏳ Ready | N/A | Test harness prepared |

