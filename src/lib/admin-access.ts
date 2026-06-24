import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-access";

function adminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailAllowlist().includes(email.toLowerCase());
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const user = await (await clerkClient()).users.getUser(userId);
  const role = String(user.publicMetadata?.role ?? "").toLowerCase();
  if (role === "admin") return true;
  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress;
  return isAdminEmail(email);
}

export async function requireAdmin(): Promise<{ userId: string; email: string | null }> {
  const userId = await requireAuth();
  const user = await (await clerkClient()).users.getUser(userId);
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;

  if (!(await isAdminUser(userId))) {
    redirect("/dashboard");
  }

  return { userId, email };
}

export async function getAdminStatus(): Promise<{ admin: boolean; email: string | null }> {
  const { userId } = await auth();
  if (!userId) return { admin: false, email: null };
  const user = await (await clerkClient()).users.getUser(userId);
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  return { admin: await isAdminUser(userId), email };
}

/** Single source of truth for admin-API gating. Performs at most ONE
 * clerkClient.users.getUser() call and returns BOTH the resolved actor (or null
 * when denied) and the canonical deny Response (or null when allowed). 401 when
 * unauthenticated, 403 when authenticated-but-not-admin — identical to the prior
 * requireAdminApi behavior. */
export async function resolveAdminApi(): Promise<{
  actor: { userId: string; email: string | null } | null;
  denied: Response | null;
}> {
  const { userId } = await auth();
  if (!userId) {
    return {
      actor: null,
      denied: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  // Single getUser covers BOTH the admin role/email gate and the actor email,
  // replacing the previous isAdminUser()+getUser() double fetch. Logic mirrors
  // isAdminUser() exactly so authorization is unchanged.
  const user = await (await clerkClient()).users.getUser(userId);
  const role = String(user.publicMetadata?.role ?? "").toLowerCase();
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  const isAdmin = role === "admin" || isAdminEmail(email);

  if (!isAdmin) {
    return {
      actor: null,
      denied: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { actor: { userId, email }, denied: null };
}

/** For API routes — returns 403/401 response or null if allowed. */
export async function requireAdminApi(): Promise<Response | null> {
  const { denied } = await resolveAdminApi();
  return denied;
}

/** Returns admin actor for audit logging, or null if denied. */
export async function getAdminApiActor(): Promise<{ userId: string; email: string | null } | null> {
  const { actor } = await resolveAdminApi();
  return actor;
}
