"use client";

import { useEffect, useState } from "react";
import { isIosAppShell } from "@/lib/ios-app-shell";

/**
 * Global iOS keyboard + visual viewport sync for the Capacitor shell.
 * Mounted once from root layout so every search/input surface benefits.
 */
export function useIosKeyboardInset(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !isIosAppShell()) return;

    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const keyboardLikely = vv.height < window.innerHeight * 0.82;
      root.classList.toggle("ios-keyboard-open", keyboardLikely);
      root.style.setProperty("--ios-vv-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--ios-vv-offset-top", `${Math.round(vv.offsetTop)}px`);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.classList.remove("ios-keyboard-open");
      root.style.removeProperty("--ios-vv-height");
      root.style.removeProperty("--ios-vv-offset-top");
    };
  }, [enabled]);
}

/** Root-level keyboard tracker — always on inside ios-app. */
export function IosKeyboardRoot() {
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(isIosAppShell()), []);
  useIosKeyboardInset(ios);
  return null;
}
