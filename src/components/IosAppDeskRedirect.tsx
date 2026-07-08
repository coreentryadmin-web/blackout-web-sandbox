"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/lib/auth-client";
import { isIosAppShell } from "@/lib/ios-app-shell";

/** Signed-in TestFlight users skip the marketing landing → open the desk. */
export function IosAppDeskRedirect() {
  const { isSignedIn, isLoaded } = useAppAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded || !isIosAppShell() || !isSignedIn) return;
    router.replace("/dashboard");
  }, [isLoaded, isSignedIn, router]);

  return null;
}
