"use client";

import { useEffect, useState } from "react";
import { isIosAppShell } from "@/lib/ios-app-shell";

const IOS_VIEWPORT =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

/** Clear WKWebView scroll/zoom artifacts after the software keyboard dismisses. */
export function resetIosViewport(): void {
  if (typeof window === "undefined" || !isIosAppShell()) return;

  const root = document.documentElement;
  window.scrollTo(0, 0);
  root.style.removeProperty("height");
  document.body.style.removeProperty("height");
  document.body.style.removeProperty("position");
  document.body.style.removeProperty("width");
  document.body.style.removeProperty("inset");
  document.body.style.removeProperty("top");

  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute("content", IOS_VIEWPORT);
}

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

    let wasOpen = false;

    const sync = () => {
      const h = Math.round(vv.height);
      const top = Math.round(vv.offsetTop);
      const open = h < window.innerHeight * 0.82;

      root.style.setProperty("--ios-vv-height", `${h}px`);
      root.style.setProperty("--ios-vv-offset-top", `${top}px`);
      root.classList.toggle("ios-keyboard-open", open);

      if (wasOpen && !open) {
        requestAnimationFrame(() => resetIosViewport());
      }
      wasOpen = open;
    };

    const onFocusOut = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      window.setTimeout(() => {
        sync();
        if (!root.classList.contains("ios-keyboard-open")) resetIosViewport();
      }, 150);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.removeEventListener("focusout", onFocusOut);
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
