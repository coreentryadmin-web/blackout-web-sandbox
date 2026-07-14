/**
 * Mint an authenticated session for audit probes — Clerk (prod) or Cognito (staging).
 */
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mintClerkPremiumSession } from "./prod-clerk-session.mjs";

const STAGING_SECRET = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";

function loadStagingSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${STAGING_SECRET}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

function cognitoRegion(poolId, fallback) {
  if (poolId?.includes("_")) return poolId.split("_")[0];
  return fallback || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";
}

function cognitoSh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** Create a disposable premium/admin Cognito user for audit probes. */
function provisionCognitoAuditUser({ poolId, region, email, password }) {
  const regionFlag = region ? ` --region "${region}"` : "";
  try {
    cognitoSh(
      `aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" ` +
        `--message-action SUPPRESS ` +
        `--user-attributes ` +
        `Name=email,Value="${email}" ` +
        `Name=email_verified,Value=true ` +
        `Name=custom:role,Value=admin ` +
        `Name=custom:tier,Value=premium` +
        regionFlag
    );
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? e);
    if (!/UsernameExistsException|already exists/i.test(msg)) throw e;
    cognitoSh(
      `aws cognito-idp admin-update-user-attributes --user-pool-id "${poolId}" --username "${email}" ` +
        `--user-attributes Name=custom:role,Value=admin Name=custom:tier,Value=premium` +
        regionFlag
    );
  }
  cognitoSh(
    `aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" ` +
      `--password "${password}" --permanent` +
      regionFlag
  );
}

function deleteCognitoAuditUser({ poolId, region, email }) {
  const regionFlag = region ? ` --region "${region}"` : "";
  cognitoSh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${regionFlag}`);
}

/** Admin-initiated auth — returns id token for bo_cognito_id cookie. */
export async function mintCognitoSession({ appUrl, email, password, poolId, clientId, clientSecret, region, cleanup }) {
  if (!email || !password || !poolId || !clientId) {
    return { skip: true, reason: "Cognito credentials or pool config missing" };
  }
  const regionFlag = region ? ` --region "${region}"` : "";
  const secretHash =
    clientSecret?.trim()
      ? createHmac("sha256", clientSecret.trim())
          .update(`${email}${clientId}`)
          .digest("base64")
      : "";
  const authParams = `USERNAME="${email}",PASSWORD="${password}"` +
    (secretHash ? `,SECRET_HASH="${secretHash}"` : "");
  try {
    const out = execSync(
      `aws cognito-idp admin-initiate-auth --user-pool-id "${poolId}" --client-id "${clientId}" ` +
        `--auth-flow ADMIN_NO_SRP_AUTH ` +
        `--auth-parameters ${authParams}` +
        regionFlag +
        ` --output json`,
      { encoding: "utf8" }
    );
    const json = JSON.parse(out);
    const idToken = json?.AuthenticationResult?.IdToken;
    const refresh = json?.AuthenticationResult?.RefreshToken;
    if (!idToken) {
      return { skip: true, reason: "Cognito admin-initiate-auth returned no IdToken" };
    }
    const parts = [`bo_cognito_id=${idToken}`];
    if (refresh) parts.push(`bo_cognito_refresh=${refresh}`);
    return {
      skip: false,
      provider: "cognito",
      cookieHeader: parts.join("; "),
      cleanup: cleanup ?? (async () => {}),
    };
  } catch (e) {
    return { skip: true, reason: `Cognito auth failed: ${e.message || e}` };
  }
}

async function mintStagingCognitoSession(secret) {
  const poolId = secret.COGNITO_USER_POOL_ID;
  const clientId = secret.COGNITO_CLIENT_ID;
  const clientSecret = secret.COGNITO_CLIENT_SECRET;
  const region = cognitoRegion(poolId, secret.AWS_REGION);
  const base = { poolId, clientId, clientSecret, region, appUrl: "" };

  const staticEmail =
    process.env.COGNITO_AUDIT_EMAIL ?? process.env.COGNITO_E2E_EMAIL ?? "admin@blackouttrades.com";
  const staticPassword =
    process.env.COGNITO_AUDIT_PASSWORD ??
    process.env.COGNITO_E2E_PASSWORD ??
    secret.COGNITO_AUDIT_PASSWORD ??
    secret.STAGING_COGNITO_SHARED_PASSWORD;

  if (staticPassword) {
    const session = await mintCognitoSession({
      ...base,
      email: staticEmail,
      password: staticPassword,
    });
    if (!session.skip) return session;
  }

  const email = process.env.COGNITO_AUDIT_EMAIL ?? `bie-audit-${Date.now()}@blackouttrades.com`;
  const password = process.env.COGNITO_AUDIT_PASSWORD ?? `BieAudit!${String(Date.now()).slice(-8)}`;
  try {
    provisionCognitoAuditUser({ poolId, region, email, password });
  } catch (e) {
    return { skip: true, reason: `Cognito audit user provision failed: ${e.message || e}` };
  }
  const session = await mintCognitoSession({
    ...base,
    email,
    password,
    cleanup: async () => {
      try {
        deleteCognitoAuditUser({ poolId, region, email });
      } catch {
        /* best-effort */
      }
    },
  });
  if (!session.skip) session.provisioned = true;
  return session;
}

/**
 * Resolve session for audit scripts. Staging + Cognito uses admin-initiate-auth;
 * otherwise falls back to Clerk temp-user minting.
 */
export async function mintAppSession({ appUrl }) {
  const isStaging = appUrl.includes("staging.");
  if (isStaging) {
    try {
      const secret = loadStagingSecret();
      const provider = secret.AUTH_PROVIDER ?? secret.NEXT_PUBLIC_AUTH_PROVIDER ?? "clerk";
      if (provider === "cognito") {
        const session = await mintStagingCognitoSession(secret);
        if (!session.skip) session.appUrl = appUrl;
        return session;
      }
    } catch (e) {
      return { skip: true, reason: `staging secret load failed: ${e.message}` };
    }
  }
  const clerk = await mintClerkPremiumSession({ appUrl });
  if (!clerk.skip) clerk.provider = "clerk";
  return clerk;
}
