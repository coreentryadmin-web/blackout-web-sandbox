/**
 * BIE eval — staging auth + proxy plumbing.
 *
 * Extracted verbatim (in behavior) from the committed vector-staging-e2e.mjs pattern: a fresh Cognito
 * temp admin+premium user is created for the run and ALWAYS deleted in a finally, the browser context
 * is routed through the agent HTTPS proxy (WS upgrades are blocked in the sandbox, so navigations that
 * 3xx-redirect are rewritten to a client-side location.replace), and sign-in drives the hosted Cognito
 * form. Reused here so the eval runner doesn't re-implement the boilerplate.
 *
 * MUST be run with the AWS creds UNSET so the shared ~/.aws/credentials profile is used:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/bie-eval/run.mjs
 */
import { execSync } from "node:child_process";

const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "";

export const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

/** Read the Cognito user-pool id from the staging secret and derive its region. */
export function cognitoConfig() {
  const s = JSON.parse(
    sh(
      `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}"` +
        (REGION ? ` --region "${REGION}"` : "") +
        ` --query SecretString --output text`
    )
  );
  const poolId = s.COGNITO_USER_POOL_ID;
  return { poolId, region: poolId?.includes("_") ? poolId.split("_")[0] : REGION };
}

export function createTempUser(poolId, region, email, password) {
  const rf = region ? ` --region "${region}"` : "";
  try {
    sh(
      `aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" ` +
        `--message-action SUPPRESS --user-attributes Name=email,Value="${email}" ` +
        `Name=email_verified,Value=true Name=custom:role,Value=admin Name=custom:tier,Value=premium${rf}`
    );
  } catch (e) {
    if (!/UsernameExists|already exists/i.test(String(e.stderr ?? e.message))) throw e;
  }
  sh(`aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" --password "${password}" --permanent${rf}`);
}

export function deleteTempUser(poolId, region, email) {
  try {
    sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`);
  } catch {
    /* best-effort cleanup */
  }
}

/** Route the browser context through the agent proxy; rewrite navigation redirects to a JS replace. */
export async function proxyRoute(ctx) {
  if (!(process.env.HTTPS_PROXY || process.env.https_proxy)) return;
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    try {
      const resp = await ctx.request.fetch(req, { maxRedirects: 0 });
      const loc = resp.headers()["location"];
      if (req.isNavigationRequest() && resp.status() >= 300 && resp.status() < 400 && loc) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<script>location.replace(${JSON.stringify(new URL(loc, req.url()).href)})</script>`,
        });
        return;
      }
      await route.fulfill({ response: resp });
    } catch {
      await route.abort();
    }
  });
}

/** Drive the hosted Cognito sign-in form and wait until we land off /sign-in. */
export async function signIn(page, email, password) {
  await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(password);
  await page
    .locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible')
    .first()
    .click();
  await page.waitForURL((u) => u.href.startsWith(STAGING) && !u.href.includes("/sign-in"), { timeout: 90_000 });
}

/** Authenticated JSON GET via the page's cookies (returns parsed body or null). */
export async function apiGet(page, path) {
  try {
    const r = await page.request.get(`${STAGING}${path}`, { headers: { accept: "application/json" }, timeout: 30_000 });
    return r.ok() ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Fire one Largo query and normalize the response shape. */
export async function askLargo(page, question, sessionId) {
  const r = await page.request.post(`${STAGING}/api/market/largo/query`, {
    headers: { accept: "application/json", "content-type": "application/json" },
    data: { question, session_id: sessionId },
    timeout: 60_000,
  });
  const j = r.ok() ? await r.json() : { answer: `HTTP ${r.status()}` };
  return { answer: j.answer ?? j.error ?? "", source: j.source ?? "", tools: j.tools_used ?? j.tools ?? [] };
}

/** Random strong password meeting Cognito complexity. */
export function randomPassword(prefix = "Bt") {
  return `${prefix}!${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2).toUpperCase()}9`;
}
