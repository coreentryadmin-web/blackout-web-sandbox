/**
 * Whether the desk should show the "halt feed degraded" banner. Only during an
 * active session — the UW trading_halts channel is event-only and goes
 * naturally quiet off-hours/holidays (see isUwHaltSourceStale's doc comment in
 * uw-socket.ts), so a stale reading outside RTH is expected, not a real
 * degradation, and showing it there is a false alarm about a feed with nothing
 * to report. A confirmed active halt is shown separately and unconditionally.
 *
 * Deliberately dependency-free: SpxDashboard.tsx (a client component) needs
 * this, and spx-play-gates.ts transitively imports uw-socket.ts's server-only
 * chain (Postgres, tracked-fetch telemetry) which cannot be bundled for the
 * browser.
 */
export function shouldShowHaltDegradedBanner(opts: {
  sessionActive: boolean;
  haltChannelStale: boolean;
  activeHaltsCount: number;
}): boolean {
  return opts.sessionActive && opts.haltChannelStale && opts.activeHaltsCount === 0;
}
