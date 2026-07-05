# SPX Slayer — all-day RTH verification agent (autonomous)

**Purpose:** On live trading days, run a dedicated Cloud Agent that verifies **every SPX Slayer surface** — especially the **0DTE GEX matrix (every cell)** — from **market open through close**, logs any defect immediately, and **fixes everything after the bell** without asking the operator.

**First scheduled run:** **Monday 2026-07-06** (normal NYSE session — Jul 3 was the observed holiday).

| Wall clock | Session |
|---|---|
| **6:30 AM PT** (= **9:30 AM ET**) | RTH open — first verify pass |
| **6:30 AM – 1:00 PM PT** (= **9:30 AM – 4:00 PM ET**) | All-day verify passes (no merges for non-critical unless P0) |
| **~1:05 PM PT** (= **4:05 PM ET**) | **Post-close fix window** — branch → fix → test → PR → merge → re-verify until GREEN |

**Prerequisite merges before first open pass:** land **PR #539** (pulse/flow cache lanes + SCANNING confirmation staleness) on `main` so tomorrow's audit validates the fixed code path.

---

## Agent modes

| Mode | When | Behavior |
|---|---|---|
| **`verify`** | Every pass during RTH (see schedule below) | Run probes + UI sweep; log P0/P1 to `OPEN-ISSUES.md`; **fix P0 live** (data leak / wrong trade signal); defer P2+ to post-close unless trivial |
| **`fix`** | Post-close (~16:05 ET) | Triage today's findings; **fix every SPX-related issue**; one issue per `fix/<slug>` branch; test; PR; merge; `validate:deploy` + full SPX pass until GREEN |

**Never ask the user for permission** during either mode.

---

## Command (single orchestrated pass)

```bash
# During RTH — exits 0 only when every SPX probe is GREEN
npm run validate:spx-rth

# Post-close — same probes + writes audit-output/spx-rth-*.md; exit 1 if anything failed
npm run validate:spx-rth -- --phase=post-close

# Off-hours dry run (holiday rehearsal)
node scripts/spx-rth-all-day-audit.mjs --force
```

### What `validate:spx-rth` checks (SPX-only, exhaustive)

1. **`validate:rth-open`** — deploy, crons, sockets, `spx-evaluate` ticking
2. **SPX matrix deep audit** — `scripts/heatmap-matrix-audit.mjs --tickers=SPX`
   - Every GEX/VEX/DEX/CHARM cell finite
   - Σ `strike_totals` == headline `total` per lens
   - Cell re-sum vs `strike_totals` (INV-2) for **every strike**
   - Walls, flip, king derivations vs reported values
   - Mapper cross-check (`gexPositioningFromHeatmap` vs matrix block)
3. **SPX cross-endpoint spot/GEX agreement** (same refresh window):
   - `/api/market/spx/desk` spot
   - `/api/market/gex-heatmap?ticker=SPX` spot
   - `/api/market/gex-positioning?ticker=SPX` spot + flip + walls
   - `/api/market/spx/play` levels (when present)
   - Tolerance: spot Δ ≤ **0.15** index points; flip/walls exact or ≤ **1** pt
4. **Desk cache lane consistency** — desk / pulse / flow / merged agree on spot + tide direction within one poll
5. **`validate:spx-bie`** — member `/spx/play` vs `getSpxPlayState()` (BIE/Largo single derivation)
6. **`/api/cron/data-correctness?force=1`** — zero SPX-layer flags
7. **`ops:collect`** — zero action items

---

## UI verification (every `verify` pass)

Run when Playwright is available (`npx playwright install chromium` once per VM):

```bash
node scripts/rth-comprehensive-sweep.mjs
node scripts/audit/rth-browser-test.mjs
```

**Focus on `/dashboard` only for SPX matrix UI:**

| Check | Pass criteria |
|---|---|
| Matrix renders | ≥ **80** strike rows during RTH; no blank ladder |
| Every visible cell | Finite formatted value or honest empty state — **never** `NaN`, `undefined`, `$—` on live strikes |
| GEX/VEX lens toggle | Both lenses populate; king ★ visible on 0DTE column |
| Spot row | Tracks desk spot within **0.15** pts (poll 8s RTH) |
| Trade alert hero | Action matches play API; **no stale ✓ confirmations during SCANNING** (PR #539) |
| LIVE / freshness chips | Not `stale` during RTH when APIs report fresh `as_of` |
| Console | Zero errors on `/dashboard` |

If browser is blocked (cloud sandbox), fall back to API probes above + capture HTTP JSON as evidence in `audit-output/`.

---

## Verify schedule (weekdays — GitHub + Cursor)

GitHub Actions workflow: **`.github/workflows/spx-rth-all-day-agent.yml`**

| Pass | ET | PT | UTC (EDT) | Mode |
|---|---|---|---|---|
| Pre-open warm-up | 09:28 | 06:28 | 13:28 | verify |
| Post-open | 09:40 | 06:40 | 13:40 | verify |
| Mid-morning | 11:00 | 08:00 | 15:00 | verify |
| Midday | 12:30 | 09:30 | 16:30 | verify |
| Afternoon | 14:00 | 11:00 | 18:00 | verify |
| Pre-close | 15:30 | 12:30 | 19:30 | verify |
| Last tick | 15:55 | 12:55 | 19:55 | verify |
| **Post-close fix** | **16:05** | **13:05** | **20:05** | **fix** |

Dual cron rows (EDT + EST) are in the workflow file. GitHub may delay scheduled runs a few minutes — acceptable.

---

## Cursor Automation (dashboard backup)

If `CURSOR_API_KEY` is missing in GitHub, create **two** automations at [cursor.com/automations](https://cursor.com/automations):

### Automation A — SPX verify (all-day)

- **Repo:** `coreentryadmin-web/blackout-web` · branch `main`
- **Schedule:** Mon–Fri, cron `28,40 13 * * 1-5` and `0 15,30 16,0 18,30 19,55 19 * * 1-5` (adjust for EST months — mirror workflow file)
- **Prompt:**

> Autonomous SPX Slayer RTH **verify** pass. Read and execute `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` in **verify** mode. Run `npm run validate:spx-rth`. Run `node scripts/rth-comprehensive-sweep.mjs` if Playwright works. Focus `/dashboard`: SPX 0DTE matrix every cell, trade alerts, no stale SCANNING confirmations. Log P0/P1 to `docs/api-audit/OPEN-ISSUES.md`; fix P0 immediately; defer P2+ to post-close. Do NOT ask the user.

### Automation B — SPX post-close fix

- **Schedule:** Mon–Fri **16:05 ET** (`5 20 * * 1-5` UTC in EDT)
- **Prompt:**

> Autonomous SPX Slayer **post-close fix** session. Read `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` in **fix** mode. Run `npm run validate:spx-rth -- --phase=post-close`. Fix **every** SPX-related finding from today (matrix cells, desk/play divergence, confirmations, cache lanes, gates). Branch `fix/<slug>` per issue, test, `docs/audit/FINDINGS.md`, draft PR, merge when GREEN, `validate:deploy`. Do NOT stop until SPX pass is fully GREEN. Do NOT ask the user.

---

## Fix loop (post-close `fix` mode)

1. Read today's entries in `docs/api-audit/OPEN-ISSUES.md` tagged `spx-rth-2026-07-06` (or current date).
2. Prioritize: **P0** (wrong numbers / trade signal) → **P1** (matrix/desk/play disagreement) → **P2**.
3. For each issue: `fix/<slug>` → minimal fix → nearest `*.test.ts` → FINDINGS.md → PR → merge.
4. After each merge: `npm run validate:deploy-wait && npm run validate:spx-rth`.
5. Final gate: `node scripts/audit/data-validator.mjs` (full cross-provider oracle) if secrets available.
6. Append post-close summary to `OPEN-ISSUES.md` — **GREEN** or list of remaining blockers.

---

## Secrets (GitHub Actions → Settings → Secrets)

| Secret | Used for |
|---|---|
| `CURSOR_API_KEY` | Launch Cloud Agents |
| `CRON_SECRET` | SPX API probes (cron bearer) |
| `DATABASE_PUBLIC_URL` | `spx-evaluate` / cron freshness |
| `POLYGON_API_KEY` | Spot oracle |
| `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Browser sweep sign-in |
| `UW_API_KEY` | GEX cross-validation (optional) |

---

## Related docs

- General RTH open: `docs/ops/RTH-OPEN-RUNBOOK.md`
- SPX audit fixes (2026-07-05): `docs/audit/SPX-AUDIT-FIXES-2026-07-05.md`, PR #535 / #539
- Platform audit skill: `.cursor/skills/platform-audit/SKILL.md`
