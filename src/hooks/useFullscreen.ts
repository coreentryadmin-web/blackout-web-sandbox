"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Drives the native Fullscreen API for the Largo terminal's full-screen toggle
 * (BIE Master Spec §6 — "Full-screen mode"). Tracks the real fullscreen state
 * via the `fullscreenchange` event so the button label stays correct even when
 * the user exits with Esc. Fails silently where the API is unavailable/blocked
 * (older iOS Safari, embedded webviews) — the terminal is already full-viewport,
 * so fullscreen is an enhancement, never a requirement.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setSupported(Boolean(document.fullscreenEnabled));
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(async () => {
    const el = ref.current;
    if (typeof document === "undefined" || !el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* user-gesture / permissions rejection — leave state as the event reports */
    }
  }, [ref]);

  return { isFullscreen, supported, toggle };
}
