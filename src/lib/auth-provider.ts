export type AuthProviderName = "clerk" | "cognito";

/** Server + build-time provider selection. Defaults to Clerk for prod. */
export function getAuthProvider(): AuthProviderName {
  const v = (
    process.env.AUTH_PROVIDER ??
    process.env.NEXT_PUBLIC_AUTH_PROVIDER ??
    "clerk"
  ).toLowerCase();
  return v === "cognito" ? "cognito" : "clerk";
}

export function isCognitoAuth(): boolean {
  return getAuthProvider() === "cognito";
}

export function isClerkAuth(): boolean {
  return !isCognitoAuth();
}

/** Client bundle — only NEXT_PUBLIC_* is available in the browser. */
export function getClientAuthProvider(): AuthProviderName {
  const v = (process.env.NEXT_PUBLIC_AUTH_PROVIDER ?? "clerk").toLowerCase();
  return v === "cognito" ? "cognito" : "clerk";
}

export function isClientCognitoAuth(): boolean {
  return getClientAuthProvider() === "cognito";
}
