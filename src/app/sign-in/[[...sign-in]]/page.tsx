import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";

export const metadata: Metadata = {
  title: "Sign in · BlackOut",
  description: "Sign in to your BlackOut account to access the live trading desk.",
};

export default function SignInPage() {
  return (
    <AuthShell mode="signin">
      <AuthFailureObserver mode="signin">
        <SignIn appearance={clerkAppearance} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
