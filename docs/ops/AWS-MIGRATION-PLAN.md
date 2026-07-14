# AWS migration plan — blackout-web on ECS Fargate

**Status (2026-07-14): COMPLETE — Railway decommissioned.** Prod and staging both run on **AWS**
(ECS Fargate, RDS Postgres + RDS Proxy, ElastiCache Redis, Secrets Manager, EventBridge crons). The
phased plan below is retained as the migration record; the `railway.*.toml` files and `scripts/railway-*.mjs`
are legacy and no longer drive live infra.

**Infra repo:** [blackout-infra](https://github.com/coreentryadmin-web/blackout-infra) — VPC, ECR, RDS, Redis, ECS, ALB, EventBridge crons

**Secrets manifest:** `docs/ops/AWS-SECRETS-MANIFEST.md`

**CDN:** Keep **Cloudflare** in front; point origin to ALB (do not add CloudFront).

---

## Phase 1 — Container (this repo)

| Step | Artifact | Done |
|------|----------|------|
| Standalone output | `output: "standalone"` in `next.config.mjs` | ✅ |
| Docker image | `deploy/Dockerfile` + `.dockerignore` (not repo root — Railway stays Nixpacks) | ✅ |
| CI → ECR | `.github/workflows/ecr-push-staging.yml` | ✅ |
| Local smoke | `docker build` + `docker run` → `/api/health` | ✅ (`blackout-infra/scripts/docker-smoke.sh`) |

**Secrets:** never in the image. Inject at runtime via ECS task definition / Secrets Manager (same keys as Railway `blackout-web`).

---

## Phase 2 — Staging stack (`blackout-infra`) ✅ Terraform ready

1. **RDS Postgres** + **RDS Proxy** + **ElastiCache Redis** (private subnets)
2. **ALB** + target group → ECS service (health: `/api/ready`, 90s start)
3. **ECS Fargate** — 1 task staging, env from Secrets Manager
4. **Crons** — EventBridge → Lambda → `GET /api/cron/*` with `CRON_SECRET` (24 jobs synced from Railway TOMLs)
5. Smoke: `npm run validate:deploy` against staging ALB URL

**Apply:** `blackout-infra` → `terraform apply -var-file=environments/staging.tfvars`

---

## Phase 3 — Production cutover

| Item | Target |
|------|--------|
| ECS tasks | 3–5 in `us-east-1` (not multi-region day one) |
| Cloudflare | Origin → ALB DNS; keep existing Transform Rules / CSP |
| Clerk | Same prod instance; add staging origin URLs if needed |
| DNS | Lower TTL 24h before cutover; `blackouttrades.com` → ALB |
| Rollback | Cloudflare origin back to Railway; keep Railway warm 48h |

---

## Phase 4 — Decommission Railway

Only after 1 week green on ECS:

- Scale Railway `blackout-web` to 0 or remove
- Migrate 23 cron trigger services to EventBridge (manifest: `npm run validate:railway-crons`)
- Archive Railway Postgres after final PITR export if RDS is authoritative

---

## Env manifest (copy to Secrets Manager)

Same as Railway `blackout-web` — see `docs/ONBOARDING.md` § secrets. Minimum for a live desk:

- `DATABASE_URL`, `REDIS_URL`
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `UW_API_KEY`, `POLYGON_API_KEY` (or `MASSIVE_API_KEY`)
- `CRON_SECRET`, `WHOP_*`, `ANTHROPIC_API_KEY`
- `PORT=8080` (if ALB target uses 8080)

---

## Non-goals

- EKS / raw EC2 worker fleet
- Clerk → Cognito (stay on Clerk for migration)
- CloudFront alongside Cloudflare
- Splitting into microservices (modular monolith + horizontal scale)
