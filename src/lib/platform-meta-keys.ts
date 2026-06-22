/**
 * Registry of `platform_meta` keys — shared TEXT key-value store (not JSONB).
 *
 * Schema (Postgres):
 *   platform_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ)
 *
 * Values are opaque strings — callers JSON.stringify/parse their own payloads.
 * Always use namespaced keys (`spx_*`, `uw_*`) to avoid collisions.
 */
export const PLATFORM_META_KEYS = {
  /** Live lotto state machine — full LottoRecord JSON, one row per trading day */
  lottoTodayState: "spx_lotto_record",
  /** Power hour lotto — separate 2:45-3:15 PM ET lane, near-money strikes */
  powerHourState: "spx_power_hour_record",
  /** WATCH→ENTRY promote scratch record */
  watchRecord: "spx_watch_record",
  /** Session buy/sell cooldown + last direction */
  playSession: "spx_play_session_meta",
  /** Claude play-gate verdict cache */
  claudePlayCache: "spx_claude_play_cache",
  /** Dedup cursor for spx_signal_log inserts */
  signalLogCursor: "spx_signal_log_cursor",
  /** UW flow ingest cursor */
  uwFlowCursor: "uw_flow_cursor",
} as const;

export type PlatformMetaKey = (typeof PLATFORM_META_KEYS)[keyof typeof PLATFORM_META_KEYS];
