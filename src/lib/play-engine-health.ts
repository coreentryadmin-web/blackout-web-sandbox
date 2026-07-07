import { dbConfigured } from "@/lib/db";
import { loadPlayEngineHeartbeat } from "@/lib/play-engine-heartbeat";
import { loadOpenPlay, loadPlaySessionMeta } from "@/features/spx/lib/spx-play-store";
import { fetchRecentSpxSignals } from "@/features/spx/lib/spx-signal-log";

export async function getPlayEngineHealth() {
  const [openPlay, sessionMeta, recentSignals] = await Promise.all([
    loadOpenPlay(),
    loadPlaySessionMeta(),
    fetchRecentSpxSignals(3).catch(() => []),
  ]);

  const lastSignal = recentSignals[0] ?? null;
  const heartbeat = await loadPlayEngineHeartbeat();

  return {
    db_configured: dbConfigured(),
    heartbeat,
    open_play: openPlay,
    session_meta: sessionMeta,
    last_signal: lastSignal
      ? {
          action: lastSignal.action,
          bias: lastSignal.bias,
          headline: lastSignal.headline,
          score: lastSignal.score,
          created_at: lastSignal.created_at,
        }
      : null,
  };
}
