import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-access";
import { isAdminEmail } from "@/lib/admin-emails";
import { auth } from "@/lib/auth-server";
import { isCognitoAuth } from "@/lib/auth-provider";
import { getUserProfile, isUserAdmin } from "@/lib/user-directory";

export { isAdminEmail } from "@/lib/admin-emails";

export async function isAdminUser(userId: string): Promise<boolean> {
  if (isCognitoAuth()) return isUserAdmin(userId);
  const { clerkClient } = await import("@clerk/nextjs/server");
  const user = await (await clerkClient()).users.getUser(userId);
  const role = String(user.publicMetadata?.role ?? "").toLowerCase();
  if (role === "admin") return true;
  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress;
  return isAdminEmail(email);
}

export async function requireAdmin(): Promise<{ userId: string; email: string | null }> {
  const userId = await requireAuth();
  const profile = await getUserProfile(userId);
  const email = profile?.email ?? null;

  if (!(await isAdminUser(userId))) {
    redirect("/dashboard");
  }

  return { userId, email };
}

export async function getAdminStatus(): Promise<{ admin: boolean; email: string | null }> {
  const { userId } = await auth();
  if (!userId) return { admin: false, email: null };
  const profile = await getUserProfile(userId);
  if (!profile) return { admin: false, email: null };
  const admin = await isAdminUser(userId);
  return { admin, email: profile.email };
}

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

  const profile = await getUserProfile(userId);
  const email = profile?.email ?? null;
  const isAdmin = await isAdminUser(userId);

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

export async function requireAdminApi(): Promise<Response | null> {
  const { denied } = await resolveAdminApi();
  return denied;
}

export async function getAdminApiActor(): Promise<{ userId: string; email: string | null } | null> {
  const { actor } = await resolveAdminApi();
  return actor;
}
