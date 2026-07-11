/**
 * Architecture operating assumptions — centralized for PLAYBOOK-ARCHITECTURE-STATUS.md.
 * Code paths should match these; when they diverge, fix code or update this module.
 */
export type PlaybookArchitectureAssumptions = {
  play_engine_poll_ms_rth: number;
  play_engine_poll_env: string;
  spx_price_primary: string;
  spx_price_fallback: string;
  session_timezone: string;
  rth_behavior: string;
  option_quotes_source: string;
  option_ticket_cache_sec: number;
  gex_model_source: string;
  gex_stale_sec_default: number;
  spx_gex_heatmap_cache_sec_default: number;
  macro_calendar_primary: string;
  macro_calendar_fallback: string;
  shadow_observation_dedup: string;
  instance_event_dedup: string;
  instance_id_formula: string;
  instance_id_known_limitation: string;
  data_retention: string;
};

export const PLAYBOOK_ARCHITECTURE_ASSUMPTIONS: PlaybookArchitectureAssumptions = {
  play_engine_poll_ms_rth: 2_000,
  play_engine_poll_env: "NEXT_PUBLIC_SPX_PLAY_POLL_MS",
  spx_price_primary:
    "Massive/Polygon index WebSocket (I:SPX) via polygon-socket indexStore; merged into desk",
  spx_price_fallback: "REST pulse snapshot when SSE disconnected (spx-desk / useMergedDesk)",
  session_timezone: "America/New_York (ET) — session_date, playbook windows, macro gates",
  rth_behavior:
    "Play evaluation + mutate path intended for cash session; off-hours polls slower / read-only paths",
  option_quotes_source:
    "Polygon/Massive REST 0DTE chain (fetchOdteContracts) — bid/ask/mid/delta/OI; 45s ticket cache",
  option_ticket_cache_sec: 45,
  gex_model_source:
    "Unusual Whales GEX heatmap + desk merge (polygon-options-gex canonical); gamma_regime from desk",
  gex_stale_sec_default: 30,
  spx_gex_heatmap_cache_sec_default: 8,
  macro_calendar_primary: "UW /api/market/economic-calendar (cached, macro-events.ts)",
  macro_calendar_fallback: "Curated US_MACRO_SCHEDULE_2026 literal when UW unavailable",
  shadow_observation_dedup:
    "spx_playbook_shadow_observations throttled by playbookShadowStateKey (primary + fired set + gate fingerprint)",
  instance_event_dedup:
    "spx_playbook_instance_events append on FSM transitions; blocked events deduped per instance+gate_blocks cursor",
  instance_id_formula: "{session}:{playbook_id}:{direction_key}:{first_armed_ms} — episode-scoped (#71)",
  instance_id_known_limitation:
    "Re-arm spawns new episode when prior terminal; temporal enforcement still partial (P0/P1)",
  data_retention:
    "No automatic purge of spx_playbook_* tables — Postgres retention = infra policy; append-only events grow unbounded",
};
