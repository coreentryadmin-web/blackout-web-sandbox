import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthBackground } from "@/components/AuthBackground";

export default function SignInPage() {
  return (
    <div className="auth-page">
      <AuthBackground />
      <div className="auth-logo">
        <h1 className="font-display text-5xl tracking-[6px] text-white text-glow">BLACKOUT</h1>
        <p className="text-[10px] tracking-[4px] text-bull uppercase mt-1">Trading Community</p>
      </div>
      <div className="relative z-10">
        <SignIn appearance={clerkAppearance} />
      </div>
    </div>
  );
}
