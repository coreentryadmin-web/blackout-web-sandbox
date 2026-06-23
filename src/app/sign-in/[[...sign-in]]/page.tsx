import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";

export default function SignInPage() {
  return (
    <AuthShell mode="signin">
      <SignIn appearance={clerkAppearance} />
    </AuthShell>
  );
}
