import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";

export const metadata: Metadata = {
  title: "Create account · BlackOut",
  description: "Create your BlackOut account to unlock the live trading desk.",
};

export default function SignUpPage() {
  return (
    <AuthShell mode="signup">
      <AuthFailureObserver mode="signup">
        <SignUp appearance={clerkAppearance} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
