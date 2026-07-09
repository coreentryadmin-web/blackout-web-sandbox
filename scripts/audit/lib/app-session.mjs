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

/** Admin-initiated auth — returns id token for bo_cognito_id cookie. */
export async function mintCognitoSession({ appUrl, email, password, poolId, clientId, clientSecret, region }) {
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
      cleanup: async () => {},
    };
  } catch (e) {
    return { skip: true, reason: `Cognito auth failed: ${e.message || e}` };
  }
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
        const email = process.env.COGNITO_AUDIT_EMAIL ?? process.env.COGNITO_E2E_EMAIL ?? "admin@blackouttrades.com";
        const password = process.env.COGNITO_AUDIT_PASSWORD ?? process.env.COGNITO_E2E_PASSWORD;
        if (!password) {
          return { skip: true, reason: "COGNITO_AUDIT_PASSWORD unset — set for staging session probes" };
        }
        return mintCognitoSession({
          appUrl,
          email,
          password,
          poolId: secret.COGNITO_USER_POOL_ID,
          clientId: secret.COGNITO_CLIENT_ID,
          clientSecret: secret.COGNITO_CLIENT_SECRET,
          region: cognitoRegion(secret.COGNITO_USER_POOL_ID, secret.AWS_REGION),
        });
      }
    } catch (e) {
      return { skip: true, reason: `staging secret load failed: ${e.message}` };
    }
  }
  const clerk = await mintClerkPremiumSession({ appUrl });
  if (!clerk.skip) clerk.provider = "clerk";
  return clerk;
}
