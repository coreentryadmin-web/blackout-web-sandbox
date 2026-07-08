import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";
import { clerkSatelliteAuthRedirect } from "@/lib/clerk-env";

export const metadata: Metadata = {
  title: "Create account · BlackOut",
  description: "Create your BlackOut account to unlock the live trading desk.",
};

type Props = {
  searchParams: Promise<{ redirect_url?: string }>;
};

export default async function SignUpPage({ searchParams }: Props) {
  const sp = await searchParams;
  const returnPath = sp.redirect_url?.startsWith("/") ? sp.redirect_url : "/dashboard";
  const satelliteRedirect = clerkSatelliteAuthRedirect("sign-up", returnPath);
  if (satelliteRedirect) {
    redirect(satelliteRedirect);
  }

  return (
    <AuthShell mode="signup">
      <AuthFailureObserver mode="signup">
        <SignUp appearance={clerkAppearance} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
