"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { clearAllSessionCache } from "@/lib/session-cache";
import { clearPlayCache } from "@/hooks/useSpxPlay";

/** Clears blackout sessionStorage keys when Clerk session ends or account switches. */
export function SessionCacheGuard() {
  const { isSignedIn, isLoaded, userId } = useAuth();
  const wasSignedIn = useRef(false);
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (wasSignedIn.current && !isSignedIn) {
      clearAllSessionCache();
      clearPlayCache();
    }
    if (isSignedIn && userId && lastUserId.current && lastUserId.current !== userId) {
      clearAllSessionCache();
      clearPlayCache();
    }
    wasSignedIn.current = Boolean(isSignedIn);
    lastUserId.current = isSignedIn ? userId ?? null : null;
  }, [isSignedIn, isLoaded, userId]);

  return null;
}
