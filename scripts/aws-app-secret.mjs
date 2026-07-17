/**
 * Load app env JSON from AWS Secrets Manager (prod + staging on ECS).
 */
import { execSync } from "node:child_process";

export function loadAwsAppSecret(secretId) {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id ${secretId} --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

export function loadProdAppSecret() {
  return loadAwsAppSecret(process.env.PRODUCTION_APP_SECRET ?? "blackout-production/app/env");
}

export function loadStagingAppSecret() {
  return loadAwsAppSecret(process.env.STAGING_APP_SECRET ?? "blackout-staging/app/env");
}
