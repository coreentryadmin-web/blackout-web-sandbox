import { auth as clerkAuth } from "@clerk/nextjs/server";
import { isCognitoAuth } from "@/lib/auth-provider";
import { getCognitoSession } from "@/lib/cognito-session";

export type AppSession = {
  userId: string | null;
  email: string | null;
};

/** Unified server session — Clerk or Cognito depending on AUTH_PROVIDER. */
export async function getSession(): Promise<AppSession> {
  if (isCognitoAuth()) {
    const session = await getCognitoSession();
    if (!session) return { userId: null, email: null };
    return {
      userId: session.userId,
      email: typeof session.claims.email === "string" ? session.claims.email : null,
    };
  }
  const { userId } = await clerkAuth();
  return { userId: userId ?? null, email: null };
}

/** Drop-in for Clerk auth() — returns { userId } shape used across the app. */
export async function auth(): Promise<{ userId: string | null }> {
  const session = await getSession();
  return { userId: session.userId };
}
