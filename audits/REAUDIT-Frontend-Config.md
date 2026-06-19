# Re-Audit — Batch 07: Frontend + Config/Deploy

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 2 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-Frontend-Config.md`

---

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **F1 / H2** | ✅ **FIXED** | `docs/api-probe/page.tsx:31,1209` — `POLYGON_API_KEY=<redacted>`; no `AUEJ8r_` prefix in source |
| **F2** | ✅ **FIXED** (post-re-audit) | Playbook moved to `private/docs/`; premium download at `src/app/api/docs/spx-playbook/route.ts`; `spx-sniper/page.tsx` links `/api/docs/spx-playbook` |
| **F3** | ✅ **FIXED** | `src/app/docs/layout.tsx:5-6` — root docs layout `requireTier("premium")` gates `api-probe`, `system-analysis`, `claude-api-analysis` |
| **F4** | ✅ **FIXED** | `.gitignore:1-2` — `.env` and `.env.production` ignored |
| **F5** | ❌ **OPEN** | `next.config.mjs:1-9` — no `headers()` security block (HSTS, CSP, frame-ancestors, etc.) |
| **F6** | ❌ **OPEN** | `TradingViewWidget.tsx` — iframe without `sandbox` (unchanged) |
| **F7** | ❌ **OPEN** | `tsconfig.json` — `"strict": false` |
| **F8** | ℹ️ INFO | `railway.toml` — unchanged; see **FC-NEW-1** for healthcheck interaction |
| **F9** | ✅ **CLEARED** | No `NEXT_PUBLIC_*` secrets in batch files |

---

## Key fix verification

### F1 — Polygon key redaction

```31:31:src/app/docs/api-probe/page.tsx
// Probed: https://api.massive.com — POLYGON_API_KEY=<redacted>
```

**Ops note:** Rotate production Polygon key if prefix was ever live — git history may retain leak.

### F3 — docs authorization

Shared premium layout covers previously free-tier internal docs. Nested layouts retain redundant gates — no bypass found.

### F4 — `.env` gitignore

Root `.env` now excluded from accidental commit.

---

## Second-pass notes (Step 3)

| ID | Status |
|----|--------|
| **S1** (CSP vs inline styles) | ❌ **OPEN** — docs still use inline `style={{}}`; strict CSP would break UI |
| **S2** (free-tier recon) | ✅ **FIXED** via F3 |
| **S3** (public playbook indexing) | ❌ **OPEN** — F2 still applies |
| **S4** (clickjacking) | ❌ **OPEN** — depends on F5 |
| **S5** (Google Fonts CDN) | ❌ **OPEN** — `globals.css` `@import` |
| **S6** (client bundle recon) | ⚠️ **MITIGATED** — premium gate reduces exposure |
| **S7** (TradingView symbol) | ❌ **OPEN** — allowlist recommendation unchanged |

---

## 🆕 New findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| **FC-NEW-1** | LOW | `api/market/health/route.ts:13-16`, `railway.toml` | H1 fix returns `{ ok: true }` to unauthenticated health probes — Railway deploy healthcheck no longer detects DB/provider failures. Cross-ref **API-NEW-1**. |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 4 (F1/H2, F3, F4, F9 cleared) |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 8 (F2, F5–F7, S1, S3–S5, S7) |
| 🆕 NEW | 1 (LOW) |
| ℹ️ INFO | 1 (F8) |

**Recommended next:** F2 (playbook behind auth API) → F5 (baseline security headers) → FC-NEW-1 (dedicated liveness endpoint).
