"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { isIosNativeShellRoute } from "@/lib/ios-tool-routes";

/** True inside the Capacitor app on signed-in native-shell routes. */
export function useIosNativeShell(): boolean {
  const path = usePathname();
  const { isSignedIn, isLoaded } = useAuth();
  const [iosApp, setIosApp] = useState(false);

  useEffect(() => {
    setIosApp(isIosAppShell());
  }, []);

  return iosApp && isLoaded && isSignedIn && isIosNativeShellRoute(path);
}
