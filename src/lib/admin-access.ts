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

/** For API routes — returns 403 response or null if allowed. */
export async function requireAdminApi(): Promise<Response | null> {
  const actor = await getAdminApiActor();
  if (!actor) {
    const { userId } = await auth();
    return new Response(JSON.stringify({ error: userId ? "Forbidden" : "Unauthorized" }), {
      status: userId ? 403 : 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/** Returns admin actor for audit logging, or null if denied. */
export async function getAdminApiActor(): Promise<{ userId: string; email: string | null } | null> {
  const { userId } = await auth();
  if (!userId || !(await isAdminUser(userId))) return null;
  const user = await (await clerkClient()).users.getUser(userId);
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  return { userId, email };
}
