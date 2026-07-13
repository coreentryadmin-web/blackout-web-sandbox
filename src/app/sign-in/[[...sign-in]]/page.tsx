import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";
import { clerkSatelliteAuthRedirect } from "@/lib/clerk-env";
import { clerkStagingReturnPath } from "@/lib/clerk-redirect-url";
import { isCognitoAuth } from "@/lib/auth-provider";

export const metadata: Metadata = {
  title: "Sign in · BlackOut",
  description: "Sign in to your BlackOut account to access the live trading desk.",
};

type Props = {
  searchParams: Promise<{ redirect_url?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const sp = await searchParams;
  const returnPath = clerkStagingReturnPath(sp.redirect_url);

  if (isCognitoAuth()) {
    const login = new URL("/api/auth/cognito/login", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
    login.searchParams.set("redirect_url", returnPath);
    redirect(login.toString());
  }

  const satelliteRedirect = clerkSatelliteAuthRedirect("sign-in", returnPath);
  if (satelliteRedirect) {
    redirect(satelliteRedirect);
  }

  return (
    <AuthShell mode="signin">
      <AuthFailureObserver mode="signin">
        <SignIn appearance={clerkAppearance} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
