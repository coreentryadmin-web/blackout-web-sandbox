"use client";

import { useEffect, useRef } from "react";
import { isClerkErrorClassName, shouldReportAuthFailure, type LastReported } from "./auth-failure-detect";

// BIE Stage 3, "security warnings / auth failure monitoring" — see the module
// comment in api/telemetry/auth-failure/route.ts for why this exists instead of
// a custom useSignIn()-based rewrite. This mounts as a SIBLING wrapper around the
// untouched prebuilt <SignIn>/<SignUp> component and watches Clerk's own
// rendered DOM for the error text Clerk already displays on a failed attempt —
// zero changes to the actual auth component, its props, or its behavior. If
// Clerk ever changes its internal class names, this silently stops reporting
// (fails open — the auth flow itself is completely unaffected either way).

function findClerkErrorElement(node: Node): HTMLElement | null {
  if (!(node instanceof HTMLElement)) return null;
  if (typeof node.className === "string" && isClerkErrorClassName(node.className)) return node;
  const match = node.querySelector<HTMLElement>('[class*="cl-formFieldErrorText"], [class*="cl-alert"]');
  return match ?? null;
}

function reportAuthFailure(message: string, mode: "signin" | "signup") {
  try {
    const body = JSON.stringify({ message, mode });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/telemetry/auth-failure", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/telemetry/auth-failure", { method: "POST", body, keepalive: true });
    }
  } catch {
    // Best-effort only — a reporting failure must never surface to the user
    // or affect the actual sign-in/sign-up flow.
  }
}

export function AuthFailureObserver({
  mode,
  children,
}: {
  mode: "signin" | "signup";
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastReportedRef = useRef<LastReported | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          const el = findClerkErrorElement(node);
          if (!el) continue;
          const text = el.textContent?.trim() ?? "";
          const now = Date.now();
          if (shouldReportAuthFailure(text, lastReportedRef.current, now)) {
            lastReportedRef.current = { message: text, at: now };
            reportAuthFailure(text, mode);
          }
          return;
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [mode]);

  return <div ref={containerRef}>{children}</div>;
}
