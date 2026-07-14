import { clerkClient } from "@clerk/nextjs/server";
import { dbQuery } from "@/lib/db";
import { isCognitoAuth } from "@/lib/auth-provider";
import { getCognitoSession } from "@/lib/cognito-session";
import { parseTier, type Tier } from "@/lib/tiers";
import { isAdminEmail } from "@/lib/admin-emails";

export type UserProfile = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  tier: Tier;
  role: string | null;
};

async function getUserRow(userId: string): Promise<{
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  tier: string | null;
} | null> {
  try {
    const result = await dbQuery<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      tier: string | null;
    }>(
      `SELECT email, first_name, last_name, tier FROM users WHERE clerk_user_id = $1 LIMIT 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Upsert users row on first Cognito login (replaces Clerk webhook for staging). */
export async function ensureCognitoUserProvisioned(
  userId: string,
  email: string | null,
  firstName: string | null,
  lastName: string | null
): Promise<void> {
  const tier = isAdminEmail(email) ? "premium" : null;
  try {
    await dbQuery(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, tier)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             first_name = COALESCE(EXCLUDED.first_name, users.first_name),
             last_name = COALESCE(EXCLUDED.last_name, users.last_name),
             tier = COALESCE(EXCLUDED.tier, users.tier),
             updated_at = NOW()`,
      [userId, email, firstName, lastName, tier]
    );
  } catch (err) {
    console.warn("[user-directory] Cognito user upsert failed:", err);
  }
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (!userId) return null;

  if (isCognitoAuth()) {
    const session = await getCognitoSession();
    const claims = session?.userId === userId ? session.claims : null;
    const row = await getUserRow(userId);
    const email =
      row?.email ??
      (typeof claims?.email === "string" ? claims.email : null);
    const tierFromClaim =
      typeof claims?.["custom:tier"] === "string" ? claims["custom:tier"] : null;
    const roleFromClaim =
      typeof claims?.["custom:role"] === "string" ? claims["custom:role"] : null;
    // Cognito custom attrs (role/tier) are on the user pool but often absent from the
    // Hosted UI id_token (openid/email/profile only). Fall back to ADMIN_EMAILS + DB tier.
    let role = roleFromClaim;
    let tier = parseTier(row?.tier ?? tierFromClaim);
    if (isAdminEmail(email) || String(role ?? "").toLowerCase() === "admin") {
      role = "admin";
      tier = "premium";
    }
    return {
      userId,
      email,
      firstName:
        row?.first_name ??
        (typeof claims?.given_name === "string" ? claims.given_name : null),
      lastName:
        row?.last_name ??
        (typeof claims?.family_name === "string" ? claims.family_name : null),
      tier,
      role,
    };
  }

  const user = await (await clerkClient()).users.getUser(userId);
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  return {
    userId,
    email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    tier: parseTier(user.publicMetadata?.tier),
    role: String(user.publicMetadata?.role ?? "") || null,
  };
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  const profile = await getUserProfile(userId);
  if (!profile) return false;
  const role = String(profile.role ?? "").toLowerCase();
  if (role === "admin") return true;
  return isAdminEmail(profile.email);
}
