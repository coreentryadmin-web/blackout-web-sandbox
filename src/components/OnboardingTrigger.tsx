"use client";

import { useAuth } from "@clerk/nextjs";
import { ONBOARDING_OPEN_EVENT } from "@/lib/onboarding-content";

/** "Learn" button for the nav — opens the onboarding guide for signed-in users. */
export function OnboardingTrigger({ className }: { className?: string }) {
  // v7: <SignedIn> is a server component and isn't exported to the client barrel, so this
  // client trigger gates on useAuth() instead (renders nothing until Clerk confirms a session).
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded || !isSignedIn) return null;
  return (
    <button
      type="button"
      className={className ?? "onboarding-nav-trigger"}
      onClick={() => window.dispatchEvent(new CustomEvent(ONBOARDING_OPEN_EVENT))}
    >
      Learn
    </button>
  );
}
