import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";
import { clerkSatelliteAuthRedirect } from "@/lib/clerk-env";

export const metadata: Metadata = {
  title: "Sign in · BlackOut",
  description: "Sign in to your BlackOut account to access the live trading desk.",
};

type Props = {
  searchParams: Promise<{ redirect_url?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const sp = await searchParams;
  const returnPath = sp.redirect_url?.startsWith("/") ? sp.redirect_url : "/dashboard";
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
