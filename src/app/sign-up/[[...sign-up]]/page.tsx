import { SignUp } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";

export default function SignUpPage() {
  return (
    <AuthShell mode="signup">
      <SignUp appearance={clerkAppearance} />
    </AuthShell>
  );
}
