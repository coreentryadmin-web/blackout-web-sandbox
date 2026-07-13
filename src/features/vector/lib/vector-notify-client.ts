"use client";

/**
 * Browser-only presenter for Vector alert notifications (delivery slice 2). Deliberately thin — all
 * the WHETHER/WHAT logic is in the pure `vector-notify` module; this only touches the DOM APIs
 * (`Notification`, the service worker) that can't be unit-tested without a browser.
 *
 * Every entry point is SSR-safe (guards `window`/`Notification`) and never throws — a member on a
 * browser without notification support, or who declines, degrades silently to the in-page-only
 * delivery from #225.
 */

import { subscribeToPush, pushConfigured, pushSupported } from "@/lib/push-client";
import type { NotifyPayload } from "./vector-notify";

export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Current browser permission, or "denied" when notifications aren't supported at all. */
export function notifyPermission(): NotificationPermission {
  if (!notifySupported()) return "denied";
  return Notification.permission;
}

/**
 * Ask the member for notification permission (the browser prompt). Returns the resulting permission.
 * Opportunistically registers a web-push subscription too — INERT when VAPID is unconfigured (the
 * common case today), so this is pure future-proofing for the server-evaluator slice and never
 * blocks or fails the local-notification path.
 */
export async function enableVectorNotifications(): Promise<NotificationPermission> {
  if (!notifySupported()) return "denied";
  let perm = Notification.permission;
  if (perm === "default") {
    try {
      perm = await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  // Register for server-push in the background if the deployment has VAPID keys. Fully inert
  // otherwise; we never await-block the UI on it and swallow any failure.
  if (perm === "granted" && pushConfigured() && pushSupported()) {
    void subscribeToPush().catch(() => undefined);
  }
  return perm;
}

/**
 * Raise a single OS notification. Prefers the service-worker registration (works even when the tab
 * is backgrounded and gives us the `tag`-based dedup + click routing in `sw.js`); falls back to a
 * page-level `Notification` when no SW controls the page. No-op if unsupported or not granted.
 */
export async function presentSystemNotification(payload: NotifyPayload): Promise<void> {
  if (!notifySupported() || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body: payload.body,
    tag: payload.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url },
  };
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(payload.title, options);
      return;
    }
  } catch {
    /* fall through to the page-level Notification */
  }
  try {
    new Notification(payload.title, options);
  } catch {
    /* best effort — member still has the in-page toast + terminal */
  }
}
