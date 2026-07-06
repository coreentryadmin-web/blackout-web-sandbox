"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { getIosRouteKey, isIosNativeShellRoute } from "@/lib/ios-tool-routes";
import type { ToolKey } from "@/lib/tool-access";
import { IosNativeHeader } from "./IosNativeHeader";
import { IosNativeMenu } from "./IosNativeMenu";

/**
 * Native iOS product shell — replaces the web Nav on signed-in routes inside
 * the Capacitor WKWebView. Web marketing/auth surfaces keep the standard Nav.
 */
export function IosAppChrome({ lockedTools = [] }: { lockedTools?: ToolKey[] }) {
  const path = usePathname();
  const { isSignedIn, isLoaded, userId } = useAuth();
  const [iosApp, setIosApp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setIosApp(isIosAppShell());
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    document.documentElement.classList.toggle("nav-locked", menuOpen);
    return () => document.documentElement.classList.remove("nav-locked");
  }, [menuOpen]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      setIsAdmin(false);
      return;
    }
    const cacheKey = `__admin_flag:${userId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached !== null) {
      setIsAdmin(cached === "1");
      return;
    }
    let cancelled = false;
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const admin = Boolean(data?.admin);
        setIsAdmin(admin);
        sessionStorage.setItem(cacheKey, admin ? "1" : "0");
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, userId]);

  const nativeActive =
    iosApp && isLoaded && isSignedIn && isIosNativeShellRoute(path);

  /* Drop head-script pending flag once we know shell state (avoids Nav flash). */
  useEffect(() => {
    if (!iosApp) return;
    if (isLoaded && !isSignedIn) {
      document.documentElement.classList.remove("ios-app-pending-shell");
    }
    if (nativeActive) {
      document.documentElement.classList.remove("ios-app-pending-shell");
    }
  }, [iosApp, isLoaded, isSignedIn, nativeActive]);

  useEffect(() => {
    document.documentElement.classList.toggle("ios-native-shell", nativeActive);
    return () => document.documentElement.classList.remove("ios-native-shell");
  }, [nativeActive]);

  useEffect(() => {
    if (!nativeActive) {
      document.documentElement.removeAttribute("data-ios-route");
      return;
    }
    document.documentElement.setAttribute("data-ios-route", getIosRouteKey(path));
    return () => document.documentElement.removeAttribute("data-ios-route");
  }, [nativeActive, path]);

  if (!nativeActive) return null;

  return (
    <>
      <div className="ios-native-ambient" aria-hidden />
      <IosNativeHeader path={path} onMenuOpen={() => setMenuOpen(true)} />
      <IosNativeMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        lockedTools={lockedTools}
        showAdmin={isAdmin}
      />
    </>
  );
}
