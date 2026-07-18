# AWS Secrets Manager manifest — blackout-web on ECS

Copy ECS `blackout-web` service variables into the Terraform-managed app secret
(`blackout-{staging|production}/app/env` JSON). **Never commit real values.**

## Minimum (staging smoke)

| Key | Source | Notes |
|-----|--------|-------|
| `DATABASE_URL` | Terraform | Auto via RDS Proxy |
| `REDIS_URL` | Terraform | Auto via ElastiCache |
| `PORT` | Terraform | `3000` (ALB target) |
| `HOSTNAME` | Terraform | `0.0.0.0` |
| `NODE_ENV` | Terraform | `production` |
| `REPLICA_COUNT` | Terraform | Matches `ecs_desired_count` |
| `CRON_SECRET` | Terraform | Auto-generated |
| `PGBOUNCER_DEFAULT_POOL_SIZE` | Terraform | `20` |
| `PG_POOL_MAX` | Terraform | `5` (1 task staging) |

## Required for live desk (copy from ECS production)

| Key | Purpose |
|-----|---------|
| `CLERK_SECRET_KEY` | Auth |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Auth (build-time in image — set in ECS env or rebuild with ARG) |
| `UW_API_KEY` | Options flow / GEX |
| `POLYGON_API_KEY` or `MASSIVE_API_KEY` | Indices / LULD |
| `WHOP_API_KEY` / `WHOP_WEBHOOK_SECRET` | Billing |
| `ANTHROPIC_API_KEY` | Largo / Night Hawk |
| `DISCORD_OPS_WEBHOOK_URL` | Ops alerts (optional staging) |

## Clerk publishable key caveat

`NEXT_PUBLIC_*` vars are baked at **build time** in Next.js. For ECS you must either:

1. Pass them as Docker build-args in CI before `docker build`, or
2. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the ECR build workflow env (recommended).

Runtime-only secrets (DB, Redis, API keys) come from Secrets Manager via ECS task `secrets`.

## Merge ECS export into Secrets Manager

```bash
# Export from ECS task definition → Environment → copy to ecs-staging.env (gitignored)
node scripts/merge-app-secret.mjs \
  --secret-name blackout-staging/app/env \
  --env-file ./ecs-staging.env
```

Then redeploy ECS:

```bash
aws ecs update-service --cluster blackout-staging-cluster --service blackout-staging-web --force-new-deployment
```

## Validate staging

```bash
CRON_TARGET_BASE_URL=http://YOUR-ALB-DNS npm run validate:deploy
```

## Cron target

EventBridge Lambda uses `CRON_TARGET_BASE_URL` (defaults to ALB DNS). After Cloudflare
origin cutover, set `cron_target_base_url` in tfvars to the staging hostname.

## Full variable list

See ECS `blackout-web` production service variables and `docs/ONBOARDING.md` § secrets.
Run `npm run validate:deploy` — warnings for missing keys indicate gaps.
