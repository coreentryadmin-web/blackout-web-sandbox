"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { MotionProvider } from "@/components/MotionProvider";
import { SessionCacheGuard } from "@/components/SessionCacheGuard";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { PwaRegister } from "@/components/PwaRegister";
import { IosViewportLock } from "@/components/ios/IosViewportLock";
import { IosKeyboardRoot } from "@/hooks/useIosKeyboardInset";
import { SharedSigilDefs } from "@/components/marks/SharedSigilDefs";
import {
  clerkAllowedRedirectOrigins,
  clerkSatelliteProviderProps,
} from "@/lib/clerk-env";

/** Clerk + motion + desk client shell — NOT loaded on the public marketing homepage. */
export function AppShellProviders({ children }: { children: React.ReactNode }) {
  const allowedRedirectOrigins = clerkAllowedRedirectOrigins();
  const satellite = clerkSatelliteProviderProps();
  return (
    <ClerkProvider
      dynamic
      {...satellite}
      {...(allowedRedirectOrigins ? { allowedRedirectOrigins } : {})}
    >
      <MotionProvider>
        <SharedSigilDefs />
        <SessionCacheGuard />
        <ClientErrorReporter />
        <PwaRegister />
        <IosViewportLock />
        <IosKeyboardRoot />
        <OnboardingGuide />
        {children}
      </MotionProvider>
    </ClerkProvider>
  );
}
