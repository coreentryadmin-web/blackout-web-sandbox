"use client";

import { useEffect } from "react";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { resetIosViewport } from "@/hooks/useIosKeyboardInset";

const IOS_VIEWPORT =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

/**
 * WKWebView auto-zooms inputs <16px and can permanently scale the page until reload.
 * Lock viewport scaling inside the Capacitor shell only (web keeps user zoom).
 */
export function IosViewportLock() {
  useEffect(() => {
    if (!isIosAppShell()) return;

    const apply = () => {
      let meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "viewport");
        document.head.appendChild(meta);
      }
      if (meta.getAttribute("content") !== IOS_VIEWPORT) {
        meta.setAttribute("content", IOS_VIEWPORT);
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true });

    const onFocusOut = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      window.setTimeout(() => resetIosViewport(), 160);
    };
    document.addEventListener("focusout", onFocusOut);

    return () => {
      observer.disconnect();
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return null;
}
