"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAppAuth } from "@/lib/auth-client";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { isIosNativeShellRoute } from "@/lib/ios-tool-routes";

/** True inside the Capacitor app on signed-in native-shell routes. */
export function useIosNativeShell(): boolean {
  const path = usePathname();
  const { isSignedIn, isLoaded } = useAppAuth();
  const [iosApp, setIosApp] = useState(false);

  useEffect(() => {
    setIosApp(isIosAppShell());
  }, []);

  return iosApp && isLoaded && isSignedIn && isIosNativeShellRoute(path);
}
