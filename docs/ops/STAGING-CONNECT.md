# Connecting to the BlackOut staging environment

**Audience:** Claude / Cursor agents / engineers validating playbook work on staging.  
**Staging app:** https://staging.blackouttrades.com  
**App repo:** `coreentryadmin-web/blackout-web-sandbox` (branch `blackout-web-sandbox`)  
**Infra repo:** `coreentryadmin-web/blackout-infra` (Terraform, Cognito, ECS, RDS)

Staging is **not** Railway. It runs on **AWS ECS Fargate** behind an ALB, fronted by **Cloudflare**. Auth is **Amazon Cognito Hosted UI** (not Clerk satellite).

---

## Architecture (one screen)

```
GitHub push → blackout-web-sandbox
    → .github/workflows/ecr-push-staging.yml
    → ECR blackout-web:staging
    → ECS blackout-staging-cluster / blackout-staging-web
    → ALB → Cloudflare → staging.blackouttrades.com

App env (API keys, Cognito, CRON_SECRET, DATABASE_URL, …)
    → AWS Secrets Manager: blackout-staging/app/env

Scheduled crons
    → Lambda blackout-staging-hit-cron → HTTPS /api/cron/* on staging hostname

Postgres / Redis
    → RDS + RDS Proxy, ElastiCache (URLs in Secrets Manager)
```

**Build-time vs runtime:** Staging images bake `AUTH_PROVIDER=cognito`, `NEXT_PUBLIC_SITE_URL=https://staging.blackouttrades.com`, and public Cognito IDs from GitHub Actions secrets. All sensitive keys load at **runtime** from Secrets Manager.

---

## 1. AWS CLI profile

### Install and configure

```bash
aws configure
# AWS Access Key ID:     <IAM user with staging access>
# AWS Secret Access Key: <secret>
# Default region:        <same region as Cognito pool / ECS — see below>
# Default output format: json
```

Optional named profile (recommended if you also use prod credentials):

```bash
aws configure --profile blackout-staging
export AWS_PROFILE=blackout-staging
export AWS_REGION=<region>   # or AWS_DEFAULT_REGION
```

**Region:** Derive from the Cognito user pool id (`{region}_{suffix}`) after loading the secret, or from `terraform output` in `blackout-infra`. Do not guess — wrong region breaks `cognito-idp` and `secretsmanager` calls.

### Verify access

```bash
aws sts get-caller-identity

aws secretsmanager describe-secret --secret-id blackout-staging/app/env

aws ecs describe-services \
  --cluster blackout-staging-cluster \
  --services blackout-staging-web \
  --query 'services[0].{status:status,running:runningCount,deployments:deployments[0].rolloutState}'
```

### Minimum IAM permissions (agent / human)

| Service | Actions needed |
|---------|----------------|
| Secrets Manager | `GetSecretValue` on `blackout-staging/app/env` |
| Cognito | `AdminCreateUser`, `AdminSetUserPassword`, `AdminInitiateAuth`, `AdminDeleteUser`, `AdminUpdateUserAttributes` on the staging user pool |
| ECS (optional) | `DescribeServices`, `UpdateService` (force redeploy) |
| Lambda (optional) | `InvokeFunction` on `blackout-staging-hit-cron` |

---

## 2. Load staging secrets (no values in git)

**Secret name:** `blackout-staging/app/env` (override with `STAGING_SECRET_NAME`).

```bash
# List keys only (safe)
aws secretsmanager get-secret-value \
  --secret-id blackout-staging/app/env \
  --query SecretString --output text \
| node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(0))).sort().join('\n'))"
```

**Auth-related keys (names only):**

| Key | Purpose |
|-----|---------|
| `AUTH_PROVIDER` | `cognito` on staging |
| `NEXT_PUBLIC_AUTH_PROVIDER` | `cognito` |
| `COGNITO_USER_POOL_ID` | User pool |
| `COGNITO_CLIENT_ID` | App client (confidential — has secret) |
| `COGNITO_CLIENT_SECRET` | OAuth + `SECRET_HASH` for admin auth |
| `COGNITO_DOMAIN` | Hosted UI prefix (`{domain}.auth.{region}.amazoncognito.com`) |
| `NEXT_PUBLIC_COGNITO_*` | Baked in image; should match runtime pool/client/domain |
| `STAGING_COGNITO_SHARED_PASSWORD` | Optional shared password for audit scripts |
| `CRON_SECRET` | Bearer token for `/api/cron/*` without browser session |

Full manifest: `docs/ops/AWS-SECRETS-MANIFEST.md`.

---

## 3. Authentication — three ways

### A. Browser (Hosted UI) — human or Playwright

1. Open https://staging.blackouttrades.com/sign-in  
2. Middleware redirects to **Cognito Hosted UI** (`amazoncognito.com`), **not** Clerk.  
3. After login, callback: `/api/auth/cognito/callback` sets cookies:
   - `bo_cognito_id` — JWT id token  
   - `bo_cognito_refresh` — refresh token (optional)

**User attributes for premium tools:**

Cognito custom attributes (set on user):

- `custom:role` → `admin` bypasses launch gates  
- `custom:tier` → `premium` for tier-gated APIs  

Read in app from JWT claims (`src/lib/cognito-session.ts`, `src/lib/user-directory.ts`).

**Automated browser E2E:**

```bash
cd blackout-web-sandbox
npm run test:staging-cognito-e2e   # if wired; or:
node scripts/staging-cognito-e2e.mjs
```

Script provisions a **temporary** admin user via AWS CLI, logs in through Hosted UI, checks `/admin` and `/api/admin/me`, then deletes the user. Screenshots → `/opt/cursor/artifacts/staging-cognito-e2e/`.

Env overrides:

```bash
COGNITO_E2E_EMAIL=user@example.com
COGNITO_E2E_PASSWORD='YourPassword123!'
STAGING_BASE_URL=https://staging.blackouttrades.com
```

---

### B. API scripts — cookie session (no browser)

Used by `scripts/audit/lib/app-session.mjs` and most `validate:staging-*` harnesses.

**Flow:**

1. Load `blackout-staging/app/env` from Secrets Manager.  
2. If `AUTH_PROVIDER=cognito`:
   - Prefer `COGNITO_AUDIT_PASSWORD` / `STAGING_COGNITO_SHARED_PASSWORD` + `COGNITO_AUDIT_EMAIL` (default `admin@blackouttrades.com`).  
   - Else **provision disposable user** (`bie-audit-<timestamp>@blackouttrades.com`) with `custom:role=admin`, `custom:tier=premium`.  
3. `aws cognito-idp admin-initiate-auth` with `ADMIN_NO_SRP_AUTH` + optional `SECRET_HASH`.  
4. Return `Cookie: bo_cognito_id=<IdToken>; bo_cognito_refresh=...`

**Example (from repo root):**

```bash
export STAGING_BASE_URL=https://staging.blackouttrades.com
# Optional — if set in Secrets Manager, scripts pick it up automatically:
# export COGNITO_AUDIT_PASSWORD='...'

node -e "
import { mintAppSession } from './scripts/audit/lib/app-session.mjs';
const s = await mintAppSession({ appUrl: process.env.STAGING_BASE_URL });
console.log(s.skip ? 'SKIP: ' + s.reason : 'provider=' + s.provider);
if (s.cookieHeader) console.log('cookie length', s.cookieHeader.length);
if (s.cleanup) await s.cleanup();
"
```

**Call a protected API:**

```bash
# After minting session (or use CRON_SECRET — see C)
curl -sS -H "Cookie: $COOKIE" -H "Accept: application/json" \
  "https://staging.blackouttrades.com/api/market/spx/play" | jq '.action, .playbook_shadow.mode'
```

---

### C. Cron / machine auth — Bearer `CRON_SECRET`

No Cognito needed. Secret value lives in `blackout-staging/app/env` → `CRON_SECRET`.

```bash
CRON=$(aws secretsmanager get-secret-value \
  --secret-id blackout-staging/app/env \
  --query SecretString --output text \
| node -e "console.log(JSON.parse(require('fs').readFileSync(0)).CRON_SECRET)")

curl -sS -H "Authorization: Bearer $CRON" \
  "https://staging.blackouttrades.com/api/cron/spx-evaluate?force=1"
```

`validate-staging-playbook.mjs` uses **CRON_SECRET first** if present (faster than Cognito provisioning).

---

## 4. Validation commands (copy-paste for agents)

From `blackout-web-sandbox` with AWS CLI working:

```bash
# Health (no auth)
curl -sS https://staging.blackouttrades.com/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://staging.blackouttrades.com/api/ready

# Playbook shadow panel (auth via CRON or Cognito — script handles it)
npm run validate:staging-playbook

# Full API harness (latency, warm, crons)
npm run validate:staging

# RTH-only checks (weekdays, market hours)
npm run validate:staging-rth

# Cognito + admin APIs
npm run validate:staging-live

# Browser Cognito sign-in
node scripts/staging-cognito-e2e.mjs

# Desk / SPX live panels (needs UW/Polygon keys in secret)
npm run validate:staging-desk-live
```

**Browser paint checks:**

```bash
STAGING_VALIDATE_BROWSER=1 npm run validate:staging
```

---

## 5. Staging-specific app behavior

| Topic | Staging behavior |
|-------|------------------|
| Auth | Cognito Hosted UI (`AUTH_PROVIDER=cognito`) |
| Playbook lab | **Always on** when `NEXT_PUBLIC_SITE_URL` contains `staging.` |
| `PLAYBOOK_LIVE_GATE` | Enabled via secret overrides |
| `PLAYBOOK_LIVE_ALLOWLIST` | Default PB-01–03 (see `apply-staging-env-overrides.mjs`) |
| Claude / Largo | **BIE-only** unless `STAGING_CLAUDE=1` in secret |
| UW budget | `UW_MAX_RPS=1` (narrower than prod) |
| Postgres | RDS snapshot / live ingest — **not** prod stream |

Code references: `AGENTS.md` (staging section), `src/lib/auth-provider.ts`, `src/middleware-cognito.ts`.

---

## 6. Deploy and rollback

**Automatic:** merge to `blackout-web-sandbox` → ECR push → ECS force-new-deployment.

**Manual redeploy (same image):**

```bash
aws ecs update-service \
  --cluster blackout-staging-cluster \
  --service blackout-staging-web \
  --force-new-deployment
```

**Check latest deploy SHA:** GitHub Actions run for workflow `ECR push (staging)` on branch `blackout-web-sandbox` — `headSha` is the built commit.

**Invoke a single cron (infra repo):**

```bash
cd blackout-infra
node scripts/invoke-staging-cron.mjs spx-evaluate
```

---

## 7. Local dev against staging data (optional)

**Default:** run app locally with local Postgres and keyless Clerk — **not** staging.

To debug staging-backed behavior locally you would need a **local `.env.local`** copied from Secrets Manager (gitignored). Prefer API scripts against `https://staging.blackouttrades.com` instead of copying prod/staging secrets to laptops.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/sign-in` redirects to `accounts.blackouttrades.com` (Clerk) | Old image or `AUTH_PROVIDER≠cognito` | Redeploy staging image; check secret `AUTH_PROVIDER` |
| `Cognito not configured` 500 | Missing pool/client/domain in ECS env | Check Secrets Manager + ECS task secret injection |
| `aws secretsmanager` AccessDenied | Wrong profile / IAM | `AWS_PROFILE`, IAM `GetSecretValue` |
| `admin-initiate-auth` fails | Wrong password or missing `SECRET_HASH` | Use `app-session.mjs`; ensure `COGNITO_CLIENT_SECRET` in secret |
| Protected APIs 401 | No cookie / expired JWT | Re-mint session; check `bo_cognito_id` |
| Playbook panel empty / stale | Off-hours or missing UW key | Check secret `UW_API_KEY`; run during RTH |
| `/api/ready` DB fail | RDS Proxy + `statement_timeout` | Secret should have `PG_STATEMENT_TIMEOUT_MS=0` (see `staging.tfvars.example`) |

---

## 9. Quick checklist for Claude second-pass review

1. `aws sts get-caller-identity` — credentials work  
2. Load secret keys — `AUTH_PROVIDER=cognito`, `CRON_SECRET` present  
3. `npm run validate:staging-playbook` — PASS  
4. `node scripts/staging-cognito-e2e.mjs` — Hosted UI + `/admin` (needs Playwright)  
5. During RTH: `npm run validate:staging-rth` + inspect `/api/market/spx/play` for open-play / FSM evidence  
6. Read audit handoff: `docs/spx/PLAYBOOK-BUG-AUDIT-2026-07-11.md` § **Handoff for Claude**

---

## Related docs

| Doc | Contents |
|-----|----------|
| `docs/spx/PLAYBOOK-BUG-AUDIT-2026-07-11.md` | What was fixed / deferred |
| `docs/ops/AWS-SECRETS-MANIFEST.md` | Secret key list |
| `blackout-infra/README.md` | Terraform, ECR, ECS cluster names |
| `scripts/audit/lib/app-session.mjs` | Cognito session minting implementation |
| `scripts/staging-cognito-e2e.mjs` | Browser Cognito E2E |
