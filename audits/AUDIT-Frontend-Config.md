# Audit — Batch 07: Frontend + Config/Deploy

> **Scope:** 110 files per `audits/AUDIT-PLAN.md`  
> **Repo:** `C:\Users\raidu\blackout-web`  
> **Audited:** 2026-06-19  
> **Focus:** App shell, landing/marketing, general pages, embeds, internal docs site, build/deploy config, public assets — with emphasis on **security headers**, **XSS in docs pages**, **client secret exposure**, **deploy config**

---

## Coverage

| Category | Files | Notes |
|----------|------:|-------|
| Config / deploy | 9 | `.gitignore`, `next.config.mjs`, `railway.toml`, `package.json`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `next-env.d.ts`, `package-lock.json` (grep + dependency review) |
| Scripts | 7 | All `.mjs`/`.cjs`/`.md` in batch read |
| Public assets | 12 | PNG/WebP/docx — binary review (no embedded scripts; docx is static export) |
| App pages | 28 | Landing, dashboard, flows, heatmap, terminal, full `/docs/**` tree |
| Components | 35 | Landing, embeds, docs tables, Nav, platform shell |
| Lib (docs data) | 17 | Polygon/UW catalogs, probe report, cursor analysis data |
| Meta | 2 | `CURSOR_IMPL.md`, `audits/AUDIT-PLAN.md` |
| **Total** | **110** | `src/app/globals.css` read via structure grep + sampled sections (260k chars — CSS-only, external Google Fonts `@import`) |

---

## Step 2 — Full read findings

### F1 — 🟠 HIGH — Polygon API key prefix committed in docs source

**File:** `src/app/docs/api-probe/page.tsx` (comment line 31, body line ~1209)

```text
POLYGON_API_KEY=AUEJ8r_...
```

**Issue:** A real Polygon/Massive API key prefix is hard-coded in tracked source. Even partial keys aid offline guessing, correlate with git history, and appear in any fork or CI checkout. This page is internal engineering documentation, not a runtime secret — but the prefix should never have been committed.

**Fix:** Redact to `POLYGON_API_KEY=<redacted>` everywhere. Rotate the Polygon key if this prefix matches production (prior commits retain the leak). Re-run probe docs without echoing key material.

**XSS note:** N/A — static string, not user input.

---

### F2 — 🟠 MEDIUM — Playbook `.docx` is publicly downloadable (auth bypass)

**Files:** `public/docs/SPX-Sniper-Playbook.docx`, link from `src/app/docs/spx-sniper/page.tsx`

**Issue:** Static files under `public/` are excluded from Clerk middleware (matcher skips `docx`). The full SPX play-engine playbook (gates, cooldowns, env tuning, DB keys) is reachable at `/docs/SPX-Sniper-Playbook.docx` **without sign-in**. The in-app download link is premium-gated, but the asset itself is not.

**Fix:** Move playbook behind a premium API route (`Content-Disposition` download after `requireTier`), or remove from `public/` and serve from authenticated server action only.

---

### F3 — 🟠 MEDIUM — Inconsistent `/docs` authorization (sign-in ≠ premium)

**Files:** `src/middleware.ts` (Clerk `protect()` on `/docs(.*)`), vs layouts/pages with `requireTier("premium")`

| Route subtree | Gate |
|---------------|------|
| `/docs/polygon/**`, `/docs/unusual-whales/**` | Layout → `requireTier("premium")` ✓ |
| `/docs/cursor-api-analysis/**`, `/docs/spx-sniper/**` | Layout/page → premium ✓ |
| `/docs/api-probe`, `/docs/system-analysis`, `/docs/claude-api-analysis` | **Middleware sign-in only** ✗ |

**Issue:** Any Clerk account (including free tier) can read full internal API catalogs, live probe analysis, production rate-limit math, env var names (`CRON_SECRET`, `DASHBOARD_API_SECRET`, provider keys), and architecture diagrams. Combined with **F1**, free signed-in users see the Polygon key prefix.

**Fix:** Add a shared `src/app/docs/layout.tsx` with `requireTier("premium")`, or apply `requireTier` on each root-level docs page. Align with product intent (“internal reference”).

---

### F4 — 🟡 MEDIUM — `.gitignore` omits plain `.env`

**File:** `.gitignore`

**Current:** Ignores `.env.local`, `.env*.local` only.

**Issue:** A root `.env` file (common on Railway/local) would not be ignored and could be committed accidentally. Scripts (`probe-docs-endpoints.mjs`, `e2e-spx-probe.mjs`) intentionally load `.env` — increases risk if developers store secrets there.

**Fix:** Add `.env` and optionally `.env.production` to `.gitignore`. Keep `.env.example` tracked with placeholders only.

---

### F5 — 🟡 LOW — No explicit security headers in Next config

**File:** `next.config.mjs`

**Issue:** No `headers()` block. Missing explicit `Strict-Transport-Security`, `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, and `Content-Security-Policy`. Next.js + Clerk provide some defaults, but a paid trading product should set baseline headers at the edge.

**Fix:** Add `async headers()` in `next.config.mjs` (or Railway/CDN layer). Start with HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (except TradingView embed pages if needed).

**CSP caveat:** Docs pages and many components use inline `style={{…}}` — strict CSP requires nonces or refactors (see Second Pass **S1**).

---

### F6 — 🟡 LOW — Third-party TradingView iframes without `sandbox`

**File:** `src/components/embeds/TradingViewWidget.tsx`

**Issue:** `<iframe src={s.tradingview.com/…}>` with no `sandbox` attribute. Expected for TV widgets, but expands third-party JS trust. Without CSP `frame-src`, any future XSS on parent pages is more dangerous.

**Mitigation already present:** `loading="lazy"`, config JSON built server-side in client from fixed templates (no user-controlled `symbol` path injection — `symbol` prop is passed into JSON, not URL path).

---

### F7 — 🟡 LOW — `tsconfig.json` has `"strict": false`

**Issue:** Weakens type safety across the frontend; indirect security risk (unvalidated props, accidental `any` flows). Not an active vuln.

---

### F8 — ℹ️ INFO — Railway deploy config

**File:** `railway.toml`

```toml
buildCommand = "DATABASE_URL=$DATABASE_PUBLIC_URL npm run build"
startCommand = "next start -H 0.0.0.0 -p $PORT"
healthcheckPath = "/api/market/health"
```

**Notes:**
- Binding `0.0.0.0` is correct for Railway containers.
- Using `DATABASE_PUBLIC_URL` for build is a common Railway pattern when private networking isn’t available at build time — ensure runtime uses private `DATABASE_URL` (handled in `src/lib/db.ts`, batch 06).
- Health check on public market endpoint is appropriate.

No misconfiguration found; document that build-phase DB URL should not log credentials.

---

### F9 — ℹ️ INFO — `NEXT_PUBLIC_*` usage in batch (expected)

| Var | File | Assessment |
|-----|------|------------|
| `NEXT_PUBLIC_SITE_URL` | `src/lib/site.ts` | ✓ Public site URL |
| `NEXT_PUBLIC_API_BASE` | `src/app/docs/cursor-api-analysis/page.tsx` | ✓ Engine base URL (not secret); client bundle via `"use client"` page |
| Whop checkout URLs | `src/components/landing/PricingSection.tsx` → `@/lib/whop-checkout` | ✓ Public checkout links (batch 01 owns secret audit) |

No `NEXT_PUBLIC_*` **secrets** found in batch 07 files. (`NEXT_PUBLIC_ENGINE_WS_KEY` removal noted in prior repo audit — not present in this batch’s client paths.)

---

## XSS sweep (docs + frontend batch)

| Check | Result |
|-------|--------|
| `dangerouslySetInnerHTML` / `__html` | **0** in batch `src/app`, `src/components` |
| `eval` / `new Function` / `document.write` | **0** |
| User-controlled HTML rendering | **None** — docs tables render static TS/JSON data via React text nodes |
| `live-probe` probe notes | `{row.probe.note}` — React-escaped ✓ |
| External links | `rel="noopener noreferrer"` on `_blank` in docs tables ✓ |
| URL/query param reflected in DOM | **None** in docs pages |

**Verdict:** No XSS sinks identified in batch 07 UI. Residual risk is **supply-chain** (TradingView iframe, Google Fonts CDN) and **missing CSP** (F5), not DOM injection in docs.

---

## ✅ Checked & cleared (Step 2)

- **Landing `/`** — public marketing; no secrets in `page.tsx` / landing components.
- **Premium app pages** (`/dashboard`, `/flows`, `/heatmap`, `/terminal`) — server `requireTier("premium")` + middleware.
- **`next.config.mjs` `images.remotePatterns`** — scoped to `images.unsplash.com` and `**.railway.app` (not wildcard `**`).
- **Docs data libs** (`docs-probe-report.json`, `cursor-api-analysis-data.ts`) — no raw API keys; paths and probe metadata only.
- **Probe scripts** — read keys from env / `.env.local` at runtime; do not write secrets into committed JSON (verified grep on `docs-probe-report.json`).
- **Embed data path** — `FlowFeed`, `Heatmap`, etc. call internal `/api/market/*` via `src/lib/api.ts`, not provider keys directly.
- **Binary public images** — standard PNG/WebP assets, no polyglot/script content reviewed at byte level (static media).

---

## Step 3 — Second pass (edge cases)

### S1 — CSP vs inline styles (deployment blocker)

Docs pages (`api-probe`, `system-analysis`, `claude-api-analysis`, etc.) heavily use inline `style={{…}}` for badges and tables. A default CSP without `'unsafe-inline'` in `style-src` will break docs UI. Plan CSP with nonces (Next 14 middleware) or move badge colors to CSS classes before enforcing strict CSP.

### S2 — Free-tier signed-in reconnaissance path

**Scenario:** User creates free account → signs in → visits `/docs/system-analysis` and `/docs/api-probe`.

**Impact:** Full production architecture, UW 403/429 analysis, cron/WS roadmap, partial Polygon key prefix (F1). This is an **authorization/product** bug, not XSS — but equivalent to leaking an internal wiki.

**Retest:** Sign in as non-premium user; confirm 200 on `/docs/api-probe` vs redirect on `/docs/polygon`.

### S3 — Public playbook indexing

`/docs/SPX-Sniper-Playbook.docx` may be indexed if linked or guessed. Treat as **confidential trade logic** exposure to competitors and scrapers (F2).

### S4 — Clickjacking on authenticated pages

Without `X-Frame-Options` / CSP `frame-ancestors`, premium desk pages could be embedded in a malicious iframe for UI-redress (user must be logged in). Lower severity than secret leak; fixed by F5 headers.

### S5 — Google Fonts supply chain

**File:** `src/app/globals.css` line 1 — `@import` from `fonts.googleapis.com`. Privacy/supply-chain consideration; self-host fonts for stricter CSP and offline resilience.

### S6 — Client bundle surface on docs analysis pages

`cursor-api-analysis/page.tsx` and `live-probe/page.tsx` are `"use client"` and import large static maps (`CURSOR_API_ANALYSIS`, `DOCS_PROBE_REPORT`). Acceptable for premium internal tools, but increases downloadable recon data for any user passing F3 gate. Not a secret leak; scope limitation only.

### S7 — Iframe `symbol` prop

`TradingViewWidget` encodes `symbol` into widget config JSON. If a future caller passed unsanitized user input, TV would receive it — currently call sites use fixed symbols. Recommend allowlist `[A-Z0-9:]+` if exposing user ticker search later.

---

## Finding counts

| Severity | Step 2 | Step 3 (new) | Total |
|----------|-------:|-------------:|------:|
| HIGH | 1 | 0 | **1** |
| MEDIUM | 3 | 0 | **3** |
| LOW | 3 | 2 | **5** |
| INFO | 2 | 0 | **2** |
| **Total findings** | **9** | **2** | **11** |

*(Step 3 LOW items S4–S5 overlap thematically with Step 2 F5/F6 — counted as second-pass hardening notes, not duplicate severities.)*

**Actionable priority:** F1 (rotate + redact) → F2 (public docx) → F3 (docs tier gate) → F4 (.gitignore) → F5 (headers).

---

## Files read (batch 07 manifest)

`.gitignore`, `CURSOR_IMPL.md`, `audits/AUDIT-PLAN.md`, `next-env.d.ts`, `next.config.mjs`, `package-lock.json`, `package.json`, `postcss.config.mjs`, `public/docs/SPX-Sniper-Playbook.docx`, `public/icon-192.png`, `public/images/.gitkeep`, `public/images/blackout-largo.png`, `public/images/dashboard-bg.png`, `public/images/hero-banner.png`, `public/images/og-image.png`, `public/images/spx-sniper-bot.png`, `public/spx-sniper/spx-sniper-bg-night.webp`, `public/spx-sniper/spx-sniper-bg-sunset.webp`, `public/spx-sniper/spx-sniper-bg-winter.webp`, `public/spx-sniper/spx-sniper-vivid-neon.webp`, `railway.toml`, `scripts/build-audit-plan.mjs`, `scripts/generate-icons.cjs`, `scripts/generate-spx-playbook-docx.mjs`, `scripts/generate-uw-docs-catalog.mjs`, `scripts/probe-docs-endpoints.mjs`, `scripts/summarize-docs-usage.mjs`, `scripts/uw-docs-index.md`, `src/app/apple-icon.png`, `src/app/dashboard/page.tsx`, `src/app/docs/api-probe/page.tsx`, `src/app/docs/claude-api-analysis/page.tsx`, `src/app/docs/cursor-api-analysis/layout.tsx`, `src/app/docs/cursor-api-analysis/live-probe/page.tsx`, `src/app/docs/cursor-api-analysis/page.tsx`, `src/app/docs/polygon/layout.tsx`, `src/app/docs/polygon/page.tsx`, `src/app/docs/polygon/rest/benzinga/page.tsx`, `src/app/docs/polygon/rest/indices/page.tsx`, `src/app/docs/polygon/rest/options/page.tsx`, `src/app/docs/polygon/rest/stocks/page.tsx`, `src/app/docs/polygon/websocket/indices/page.tsx`, `src/app/docs/polygon/websocket/options/page.tsx`, `src/app/docs/polygon/websocket/stocks/page.tsx`, `src/app/docs/spx-sniper/cursor-spx-slayer-analysis/page.tsx`, `src/app/docs/spx-sniper/page.tsx`, `src/app/docs/system-analysis/page.tsx`, `src/app/docs/unusual-whales/endpoints/page.tsx`, `src/app/docs/unusual-whales/layout.tsx`, `src/app/docs/unusual-whales/page.tsx`, `src/app/flows/page.tsx`, `src/app/globals.css`, `src/app/heatmap/page.tsx`, `src/app/icon.png`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/terminal/page.tsx`, `src/components/AuthBackground.tsx`, `src/components/BrandImage.tsx`, `src/components/CustomCursor.tsx`, `src/components/FlowFeed.tsx`, `src/components/Heatmap.tsx`, `src/components/HeroBanner.tsx`, `src/components/LandingChrome.tsx`, `src/components/Nav.tsx`, `src/components/PageBanner.tsx`, `src/components/ScrollProgressBar.tsx`, `src/components/docs/PolygonDocsNav.tsx`, `src/components/docs/PolygonRestEndpointTable.tsx`, `src/components/docs/UwDocsNav.tsx`, `src/components/docs/UwEndpointTable.tsx`, `src/components/embeds/DashboardEmbeds.tsx`, `src/components/embeds/EmbedFrame.tsx`, `src/components/embeds/FlowVolumeChart.tsx`, `src/components/embeds/FlowsEmbeds.tsx`, `src/components/embeds/HeatmapEmbeds.tsx`, `src/components/embeds/LiveFlowTape.tsx`, `src/components/embeds/LiveMarketPulse.tsx`, `src/components/embeds/TradingViewWidget.tsx`, `src/components/landing/FadeInImage.tsx`, `src/components/landing/FaqSection.tsx`, `src/components/landing/FeaturesGrid.tsx`, `src/components/landing/FloatingPanel.tsx`, `src/components/landing/HeroSection.tsx`, `src/components/landing/HeroToolsRail.tsx`, `src/components/landing/LandingCta.tsx`, `src/components/landing/LandingFooter.tsx`, `src/components/landing/MarqueeStrip.tsx`, `src/components/landing/OverlapShowcase.tsx`, `src/components/landing/PricingSection.tsx`, `src/components/platform/PlatformEmpty.tsx`, `src/components/platform/PlatformShell.tsx`, `src/lib/cursor-api-analysis-data.ts`, `src/lib/cursor-api-analysis-meta.ts`, `src/lib/docs-probe-report.json`, `src/lib/docs-probe-report.ts`, `src/lib/docs-usage-summary.json`, `src/lib/images.ts`, `src/lib/platform-meta-keys.ts`, `src/lib/polygon-docs-benzinga-rest.ts`, `src/lib/polygon-docs-indices-rest.ts`, `src/lib/polygon-docs-nav.ts`, `src/lib/polygon-docs-options-rest.ts`, `src/lib/polygon-docs-rest-types.ts`, `src/lib/polygon-docs-stocks-rest.ts`, `src/lib/site.ts`, `src/lib/uw-docs-catalog.ts`, `src/lib/uw-docs-nav.ts`, `tailwind.config.ts`, `tsconfig.json`.
