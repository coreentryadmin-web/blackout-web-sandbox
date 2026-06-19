# Re-Audit Round 2 — Batch 07: Frontend + Config/Deploy

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68`  
> **Original:** `audits/AUDIT-Frontend-Config.md`

---

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **F1** | HIGH | ✅ **FIXED** | `api-probe/page.tsx:31,1209` — `POLYGON_API_KEY=<redacted>` |
| **F2** | MEDIUM | ⚠️ **PARTIAL** | Public docx removed; `api/docs/spx-playbook/route.ts:7-11` reads `private/docs/…` — **no `private/` dir in repo**; build does not run `docs:playbook` → premium download likely 404 |
| **F3** | MEDIUM | ✅ **FIXED** | `docs/layout.tsx:5-7` — `requireTier("premium")` |
| **F4** | MEDIUM | ✅ **FIXED** | `.gitignore:1-2` — `.env`, `.env.production` |
| **F5** | LOW | ✅ **FIXED** | `next.config.mjs:2-20` — HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy |
| **F6** | LOW | ✅ **FIXED** | `TradingViewWidget.tsx:159` — `sandbox="allow-scripts allow-same-origin allow-popups allow-forms"` |
| **F7** | LOW | ❌ **OPEN** | `tsconfig.json:10` — **`"strict": false`** (prior REAUDIT claimed `strict: true` — incorrect) |
| **F8** | INFO | ℹ️ **VERIFIED** | `railway.toml:7` — `healthcheckPath = "/api/health"`; `api/health/route.ts:7-19` |
| **F9** | INFO | ℹ️ **VERIFIED** | No `NEXT_PUBLIC_*` secrets in batch paths |

---

## Challenge to prior "0 OPEN" claim

F7 was incorrectly marked FIXED in Phase 3 REAUDIT. F2 auth gate is correct but deploy artifact missing.

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 6 |
| ⚠️ PARTIAL | 1 |
| ❌ OPEN | 1 |
| 🆕 NEW | 0 |
| ℹ️ INFO | 2 |
