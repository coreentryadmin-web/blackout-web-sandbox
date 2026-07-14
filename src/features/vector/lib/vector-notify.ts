/**
 * Vector alerts — OS/browser notification layer (delivery slice 2). This is the pure, testable
 * half: it decides WHETHER a fired alert should surface as a system notification and WHAT that
 * notification says. The thin browser-only presenter (`vector-notify-client`) consumes these.
 *
 * Why a separate module from the in-page delivery (#225): the toast + terminal ALERTS section only
 * reach a member who is LOOKING at the Vector tab. A member who has tabbed away — the common case
 * while price grinds toward a wall — sees nothing. An OS notification (via the already-registered
 * service worker) reaches them anywhere in the browser. Kept free of `window`/`Notification` so the
 * fire→payload and the should-we-notify policy are unit-tested without a DOM.
 *
 * SCOPE (honest): this fires notifications for alerts the CLIENT evaluates on each live SSE tick —
 * i.e. only while the page is RUNNING (foreground or a backgrounded-but-alive tab). True
 * delivery-when-the-tab-is-fully-closed needs a SERVER-side evaluator (member rules persisted
 * server-side + a cron that calls `sendWebPush`) — that is a deliberate follow-up, not this slice.
 * The device is still registered for push here (opportunistically, when VAPID is configured) so that
 * follow-up has a subscription to send to.
 */

import type { FiredAlert } from "./vector-alerts";

export type NotifyPayload = {
  title: string;
  body: string;
  /** Dedup key — a newer fire for the SAME ticker+kind+level REPLACES the prior banner (not stacks). */
  tag: string;
  /** Deep-link the notification click opens. */
  url: string;
};

/**
 * Format a fired alert into an OS-notification payload. The title carries the ticker + a short verb
 * so it reads at a glance from the notification shade; the body reuses the engine's already-composed
 * human message. The tag is level-scoped so repeated ticks around one wall collapse to a single
 * banner rather than spamming the shade.
 */
export function notificationForFire(fire: FiredAlert): NotifyPayload {
  const verb = fire.kind === "wall-touch" ? "wall touch" : "gamma flip cross";
  // Level rounded into the tag so micro-jitter around the exact strike doesn't mint new banners,
  // but a genuinely different level (a different wall) still gets its own.
  const levelKey = Number.isFinite(fire.level) ? Math.round(fire.level) : "na";
  return {
    title: `${fire.ticker} — ${verb}`,
    body: fire.message,
    tag: `vector:${fire.ticker}:${fire.kind}:${levelKey}`,
    url: `/vector?ticker=${encodeURIComponent(fire.ticker)}`,
  };
}

export type NotifyGate = {
  /** Member turned device notifications ON for Vector (persisted). */
  enabled: boolean;
  /** Browser Notification permission state. */
  permission: NotificationPermission;
  /** Whether the Vector tab is currently hidden (backgrounded / another tab). */
  hidden: boolean;
};

/**
 * Policy: should a fired alert raise a SYSTEM notification right now?
 *
 * Only when the member enabled it AND granted permission AND the tab is HIDDEN. The last clause is
 * deliberate — when the member is actively looking at Vector, the in-page toast + terminal ALERTS
 * section (#225) already surface the fire; a duplicate OS banner over a visible tab is pure noise.
 * The OS channel exists precisely for the tabbed-away case.
 */
export function shouldSystemNotify(gate: NotifyGate): boolean {
  return gate.enabled && gate.permission === "granted" && gate.hidden;
}
