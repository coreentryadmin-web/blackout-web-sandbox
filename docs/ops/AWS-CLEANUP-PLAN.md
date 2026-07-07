# AWS prep + codebase cleanup plan

**Branch:** `feat/aws-prep` (long-lived; merge to `main` in small PRs — do not big-bang)

**Infra repo:** [blackout-infra](https://github.com/coreentryadmin-web/blackout-infra) (Terraform VPC/ECR → RDS/ECS later)

**Prod stays on `main` + Railway** until staging ECS is green and we cut over.

---

## Do NOT rewrite the framework

**Keep Next.js 15 (App Router).** Next.js *is* React. Moving to “plain React” (e.g. Vite SPA) would:

- Require a **separate backend** for ~120 `/api/*` routes, crons, WebSockets, Clerk middleware
- Lose SSR/streaming where useful
- Be **months** of work with **no guaranteed speed gain**

Speed comes from **bundle size, caching, and infra** — not ejecting Next.

For AWS: add `output: "standalone"` + `Dockerfile` (same Next app, containerized).

---

## What “cleanup” actually fixes

| Work | Runtime speed | Maintainability |
|------|---------------|-----------------|
| Delete files **never imported** | ~none | good |
| Remove dead **imports** in client trees | **high** | good |
| Code-split heavy routes (Vector, desk, Thermal) | **high** | good |
| Folder renames (cosmetic) | none | good if gradual |
| AWS + 5 Fargate tasks | under load | ops |

---

## Phased execution (merge order)

### Phase 0 — Measure (no deletes)
- [ ] `npm run build` → note route bundle sizes from `.next` output
- [ ] `scripts/site-latency-audit.mjs` on prod routes
- [ ] Inventory dead routes (grid deleted, middleware matchers, ios `grid` CSS)
- [ ] Document env manifest for AWS Secrets Manager

### Phase 1 — AWS blockers (merge first)
- [x] `next.config.mjs`: `output: "standalone"`
- [x] `Dockerfile` + `.dockerignore`
- [x] GitHub Action: build image → push ECR (staging) — `ecr-push-staging.yml`
- [x] `docs/ops/AWS-MIGRATION-PLAN.md` cutover checklist

### Phase 2 — Safe dead code (one PR per area) — **PR #1 in progress**
- [x] Stale **grid** references (`ONBOARDING.md`, ios CSS `[data-ios-route="grid"]`, audit scripts)
- [x] Delete orphan components (~40 files, ~9k LOC) — desk panels, dead embeds, landing chrome
- [x] Archive June 2026 audit pile → `docs/archive/2026-06/`; delete `docs/auto/` SDLC logs
- [x] `scripts/nighthawk-worker.ts` deleted (edition runs via `api/cron/nighthawk-edition`)
- [x] `/vector` added to middleware protected routes
- [ ] Duplicate fetch paths already flagged in `FINDINGS.md` — fix remaining only with tests

### Phase 3 — Client bundle diet (speed PRs)
- [x] Dynamic `import()` for Vector chart (`VectorPageShell` → `VectorChart` code-split)
- [ ] Ensure Largo/Anthropic code never in desk/vector client chunks
- [ ] Review `@/` imports from client components into server-only chains

### Phase 4 — Folder structure (gradual, not big-bang)
Current layout is tool-oriented (`components/desk`, `features/vector`, `lib/nighthawk`). **Do not** move everything at once.

- [x] Vector → `src/features/vector/` (components + lib + barrel export)
- `src/lib/providers/*` — keep (data layer)
- `src/lib/ws/*` — keep (sockets)
- Align page shells: `*PageShell.tsx` under `components/<tool>/`

### Phase 5 — Infra (`blackout-infra`)
- [ ] Staging: VPC + ECR (done in repo)
- [ ] RDS + RDS Proxy + ElastiCache
- [ ] ECS 1 task → validate → scale to 5
- [ ] Cloudflare origin → ALB

---

## Branch policy

| Branch | Purpose |
|--------|---------|
| `main` | Production (Railway) |
| `feat/aws-prep` | AWS + cleanup PRs target here first, then merge to `main` |
| `blackout-infra` | Terraform only |

**Never** maintain a second full app copy — it will diverge.

---

## PR rules (each cleanup PR)

1. One concern per PR (grid dead code OR Dockerfile OR one route code-split)
2. `npx tsc --noEmit` + `npm test` + `npm run build`
3. Log material findings in `docs/audit/FINDINGS.md`
4. Auto-merge when CI green

---

## Explicit non-goals (this pass)

- Rewriting Next → Vite/CRA
- Replacing Clerk with Cognito
- Replacing Cloudflare with CloudFront
- Moving every file “into correct folders” in one diff
- Deleting `scripts/audit/*` or `docs/*` bulk (not runtime trash)
