# AWS prep + codebase cleanup plan

**Sandbox repo:** `coreentryadmin-web/blackout-web-sandbox` → branch `blackout-web-sandbox`

**Prod repo:** `coreentryadmin-web/blackout-web` → `main` (Railway only — cherry-pick when ready)

**Infra repo:** [blackout-infra](https://github.com/coreentryadmin-web/blackout-infra) (Terraform VPC/ECR → RDS/ECS later)

---

## Do NOT rewrite the framework

**Keep Next.js 15 (App Router).** Speed comes from bundle size, caching, and infra — not ejecting Next.

For AWS: `output: "standalone"` + `deploy/Dockerfile` (same Next app, containerized).

---

## Phased execution

### Phase 0 — Measure
- [x] `npm run build` — route bundle sizes recorded on sandbox
- [ ] `scripts/site-latency-audit.mjs` on staging (post-ECS)
- [x] Dead routes inventoried (grid, nights-watch removed)
- [ ] Document env manifest for AWS Secrets Manager (manual Railway export)

### Phase 1 — AWS blockers
- [x] `next.config.mjs`: `output: "standalone"`
- [x] `deploy/Dockerfile` + `.dockerignore` (not repo root — Railway stays Nixpacks)
- [x] GitHub Action: ECR push (`ecr-push-staging.yml`)
- [x] `docs/ops/AWS-MIGRATION-PLAN.md`

### Phase 2 — Safe dead code
- [x] Stale grid / nights-watch references
- [x] Orphan components deleted (~40 files)
- [x] Audit pile archived
- [x] `/vector` middleware protected
- [x] Dead CSS purged (`.grid-*`, `.nighthawk-watch-*`, agent sidebar) from `globals.css`
- [ ] Remaining duplicate fetch paths in FINDINGS.md (fix with tests as found)

### Phase 3 — Client bundle diet
- [x] Vector chart code-split
- [x] Thermal GexHeatmap `ssr:false`
- [ ] Audit Largo/Anthropic imports in client trees (ongoing guard)
- [x] Tailwind `content` includes `./src/features/**` (P0 — CSS purge fix)

### Phase 4 — Folder structure ✅ (sandbox)
- [x] `src/features/{spx,helix,thermal,nighthawk,largo,vector}/`
- [x] PageShells under `features/*/components/`
- [x] HELIX flow panels moved from `components/desk/` → `features/helix/components/`
- [x] Thermal gex-heatmap helpers → `features/thermal/lib/gex-heatmap/`
- [x] ZeroDteBoard → `features/nighthawk/components/`
- [x] Shared chrome: `components/layout/`, `components/upgrade/`
- [x] SPX tests colocated under `features/spx/lib/`
- [x] `components/desk/` directory removed
- [x] Scripts updated for new paths (`validate-ios-mobile-desk`, audit scripts)
- [x] `docs/ONBOARDING.md` refreshed

### Phase 5 — Infra (`blackout-infra`)
- [x] Staging: VPC + ECR
- [ ] RDS + RDS Proxy + ElastiCache
- [ ] ECS 1 task → validate → scale
- [ ] Cloudflare origin → ALB

---

## Branch policy

| Repo / branch | Purpose |
|---------------|---------|
| **`blackout-web` → `main`** | Production (Railway). Hotfixes only. |
| **`blackout-web-sandbox` → `blackout-web-sandbox`** | All AWS/cleanup/refactor work. |
| **`blackout-infra`** | Terraform only |

Cherry-pick proven sandbox commits to prod `main` — never auto-merge sandbox → prod.

---

## PR rules (sandbox)

1. One concern per commit/PR when possible
2. `npx tsc --noEmit` + `npm test` + `npm run build`
3. Log material findings in `docs/audit/FINDINGS.md`
4. **Do not** open PRs to prod unless explicitly a hotfix
