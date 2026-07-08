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
import { isClientCognitoAuth } from "@/lib/auth-provider";
import { CognitoAuthProvider } from "@/lib/auth-client";

function DeskShell({ children }: { children: React.ReactNode }) {
  return (
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
  );
}

/** Clerk + motion + desk client shell — NOT loaded on the public marketing homepage. */
export function AppShellProviders({ children }: { children: React.ReactNode }) {
  if (isClientCognitoAuth()) {
    return (
      <CognitoAuthProvider>
        <DeskShell>{children}</DeskShell>
      </CognitoAuthProvider>
    );
  }

  const allowedRedirectOrigins = clerkAllowedRedirectOrigins();
  const satellite = clerkSatelliteProviderProps();
  return (
    <ClerkProvider
      dynamic
      {...satellite}
      {...(allowedRedirectOrigins ? { allowedRedirectOrigins } : {})}
    >
      <DeskShell>{children}</DeskShell>
    </ClerkProvider>
  );
}
