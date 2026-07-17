type SessionPulse = {
  market_open?: boolean;
  market_label?: string;
  market_status?: string;
  price?: number;
};

/** Client-side session gate — always open so spot prices poll 24/7.
 * Server pulse response drives UI labels (OPEN/CLOSED/PRE-MARKET). */
export function isClientDeskSessionOpen(_now = new Date()): boolean {
  return true;
}

export function isDeskSessionLiveFromPulse(pulse?: SessionPulse | null): boolean {
  if (!pulse) return false;
  return (
    pulse.market_open === true ||
    pulse.market_label === "PRE-MARKET" ||
    pulse.market_status === "premarket"
  );
}

/** True when the desk should poll pulse/flow/play and render the live session UI. */
export function resolveDeskSessionActive(opts: {
  initialized: boolean;
  pulse?: SessionPulse | null;
  deskStable?: SessionPulse | null;
  etSessionOpen: boolean;
}): boolean {
  if (opts.etSessionOpen) return true;
  if (!opts.initialized) return false;
  return (
    isDeskSessionLiveFromPulse(opts.pulse) || isDeskSessionLiveFromPulse(opts.deskStable)
  );
}

/** True when member-facing numbers are live (not a post-close snapshot). */
export function resolveDeskLive(opts: {
  sessionActive: boolean;
  merged?: {
    available?: boolean;
    price?: number;
    feed_stalled?: boolean;
    market_open?: boolean;
    market_label?: string;
    market_status?: string;
  } | null;
  etSessionOpen: boolean;
}): boolean {
  const m = opts.merged;
  if (!opts.sessionActive || !m?.available || !(m.price ?? 0)) return false;
  if (m.feed_stalled) return false;
  if (
    m.market_open === true ||
    m.market_label === "PRE-MARKET" ||
    m.market_status === "premarket"
  ) {
    return true;
  }
  // SSE-only pulse overlays price without market_open — trust the ET clock during RTH.
  return opts.etSessionOpen;
}

/** Drop a post-close sessionStorage desk during a new RTH open (prevents OFFLINE loop). */
export function shouldDiscardStaleClosedDeskCache(
  cached: SessionPulse | null | undefined,
  etSessionOpen: boolean
): boolean {
  if (!etSessionOpen || !cached) return false;
  if (cached.market_open === true) return false;
  if (cached.market_label === "PRE-MARKET" || cached.market_status === "premarket") return false;
  return cached.market_label === "CLOSED" || cached.market_open === false;
}
