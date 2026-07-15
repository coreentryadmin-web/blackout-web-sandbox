/**
 * Client SWR poll cadence for SPX desk lanes (milliseconds).
 * Override at build time via NEXT_PUBLIC_SPX_*_POLL_MS env vars (staging ECS build args).
 */

function pollMs(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 500 ? Math.round(n) : fallback;
}

/** Play engine + trade alerts + playbook shadow — default 2s RTH. */
export const SPX_PLAY_POLL_MS = pollMs("NEXT_PUBLIC_SPX_PLAY_POLL_MS", 2_000);

/** UW flow tape + GEX strikes overlay — default 2s. */
export const SPX_FLOW_POLL_MS = pollMs("NEXT_PUBLIC_SPX_FLOW_POLL_MS", 2_000);

/** Full desk rebuild (walls, levels, enrichment) — default 5s. */
export const SPX_FULL_DESK_POLL_MS = pollMs("NEXT_PUBLIC_SPX_FULL_DESK_POLL_MS", 5_000);

/** REST pulse fallback when SSE disconnected — default 1s. */
export const SPX_PULSE_REST_POLL_MS = pollMs("NEXT_PUBLIC_SPX_PULSE_REST_POLL_MS", 1_000);

/** REST pulse when SSE connected (spot still pushes @ 250ms) — default 5s. */
export const SPX_PULSE_REST_SSE_POLL_MS = pollMs("NEXT_PUBLIC_SPX_PULSE_REST_SSE_POLL_MS", 5_000);

/** Left-rail GEX/VEX matrix during RTH — default 5s (pairs with SPX_GEX_HEATMAP_CACHE_SEC). */
export const SPX_MATRIX_POLL_RTH_MS = pollMs("NEXT_PUBLIC_SPX_MATRIX_POLL_RTH_MS", 5_000);

/** Matrix off-hours / AH — default 5s. */
export const SPX_MATRIX_POLL_OFF_MS = pollMs("NEXT_PUBLIC_SPX_MATRIX_POLL_OFF_MS", 5_000);

/** Lotto track during cash session — default 5s. */
export const SPX_LOTTO_OPEN_POLL_MS = pollMs("NEXT_PUBLIC_SPX_LOTTO_OPEN_POLL_MS", 5_000);

/** Lotto pre-market — default 60s. */
export const SPX_LOTTO_PREMARKET_POLL_MS = pollMs("NEXT_PUBLIC_SPX_LOTTO_PREMARKET_POLL_MS", 60_000);

/** Power hour in-window — default 5s. */
export const SPX_POWER_HOUR_POLL_MS = pollMs("NEXT_PUBLIC_SPX_POWER_HOUR_POLL_MS", 5_000);

/** Power hour post-window hold tail — default 60s. */
export const SPX_POWER_HOUR_OFF_POLL_MS = pollMs("NEXT_PUBLIC_SPX_POWER_HOUR_OFF_POLL_MS", 60_000);
