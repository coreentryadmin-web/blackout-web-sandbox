import { NextResponse } from "next/server";
import { getCognitoSession } from "@/lib/cognito-session";
import { getUserProfile } from "@/lib/user-directory";
import { isCognitoAuth } from "@/lib/auth-provider";
import { auth as clerkAuth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isCognitoAuth()) {
    const session = await getCognitoSession();
    if (!session) {
      return NextResponse.json({ signedIn: false, userId: null, email: null });
    }
    const profile = await getUserProfile(session.userId);
    return NextResponse.json({
      signedIn: true,
      userId: session.userId,
      email: profile?.email ?? session.claims.email ?? null,
      firstName: profile?.firstName ?? null,
      lastName: profile?.lastName ?? null,
      tier: profile?.tier ?? "free",
      role: profile?.role ?? null,
    });
  }

  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ signedIn: false, userId: null, email: null });
  }
  const profile = await getUserProfile(userId);
  return NextResponse.json({
    signedIn: true,
    userId,
    email: profile?.email ?? null,
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    tier: profile?.tier ?? "free",
    role: profile?.role ?? null,
  });
}
