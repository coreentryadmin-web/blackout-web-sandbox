import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import {
  isPostEntryPlaybookState,
  isTerminalPlaybookState,
  verdictCandidateState,
  type PlaybookLifecycleState,
} from "@/features/spx/lib/playbook-trade-fsm";

/** Direction bucket embedded in durable instance_id. */
export type EpisodeDirectionKey = "long" | "short" | "undirected";

export type PlaybookInstanceSnapshot = {
  instance_id: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  state: PlaybookLifecycleState;
  episode_direction: EpisodeDirectionKey;
  episode_start_ms: number;
  triggered_at_ms: number | null;
};

export function episodeDirectionKey(direction: "long" | "short" | null): EpisodeDirectionKey {
  return direction ?? "undirected";
}

/** One research episode — distinct setup opportunity within a session. */
export function playbookInstanceId(
  sessionDate: string,
  playbookId: PlaybookId,
  direction: EpisodeDirectionKey,
  episodeStartMs: number
): string {
  return `${sessionDate}:${playbookId}:${direction}:${episodeStartMs}`;
}

/** @deprecated Legacy coarse key — one row per playbook per session. */
export function legacyPlaybookInstanceId(sessionDate: string, playbookId: PlaybookId): string {
  return `${sessionDate}:${playbookId}`;
}

export function isLegacyPlaybookInstanceId(instanceId: string): boolean {
  const parts = instanceId.split(":");
  return parts.length === 2;
}

export function parsePlaybookInstanceId(instanceId: string): {
  session_date: string;
  playbook_id: PlaybookId;
  episode_direction: EpisodeDirectionKey;
  episode_start_ms: number;
  legacy: boolean;
} {
  const parts = instanceId.split(":");
  if (parts.length === 2) {
    return {
      session_date: parts[0],
      playbook_id: parts[1] as PlaybookId,
      episode_direction: "undirected",
      episode_start_ms: 0,
      legacy: true,
    };
  }
  if (parts.length >= 4) {
    const episodeStartMs = Number(parts[parts.length - 1]);
    const episodeDirection = parts[parts.length - 2] as EpisodeDirectionKey;
    const playbookId = parts[parts.length - 3] as PlaybookId;
    const sessionDate = parts.slice(0, parts.length - 3).join(":");
    return {
      session_date: sessionDate,
      playbook_id: playbookId,
      episode_direction: episodeDirection,
      episode_start_ms: Number.isFinite(episodeStartMs) ? episodeStartMs : 0,
      legacy: false,
    };
  }
  return {
    session_date: parts[0] ?? "",
    playbook_id: (parts[1] ?? "PB-01") as PlaybookId,
    episode_direction: "undirected",
    episode_start_ms: 0,
    legacy: true,
  };
}

export function snapshotFromInstanceRow(row: {
  instance_id: string;
  playbook_id: string;
  direction: "long" | "short" | null;
  state: PlaybookLifecycleState;
  triggered_at_ms?: number | null;
}): PlaybookInstanceSnapshot {
  const parsed = parsePlaybookInstanceId(row.instance_id);
  return {
    instance_id: row.instance_id,
    playbook_id: row.playbook_id as PlaybookId,
    direction: row.direction,
    state: row.state,
    episode_direction: parsed.episode_direction,
    episode_start_ms: parsed.episode_start_ms,
    triggered_at_ms: row.triggered_at_ms ?? null,
  };
}

function directionsCompatible(
  episodeDir: EpisodeDirectionKey,
  rowDirection: "long" | "short" | null,
  verdictDirection: "long" | "short" | null
): boolean {
  const verdictKey = episodeDirectionKey(verdictDirection);
  if (episodeDir === "undirected") {
    if (verdictKey === "undirected") return true;
    return rowDirection == null || rowDirection === verdictDirection;
  }
  if (verdictKey === "undirected") {
    return rowDirection == null || rowDirection === episodeDir;
  }
  return episodeDir === verdictKey;
}

function isActiveEpisodeState(state: PlaybookLifecycleState): boolean {
  return !isTerminalPlaybookState(state);
}

function shouldSpawnEpisode(
  fromState: PlaybookLifecycleState | undefined,
  candidate: PlaybookLifecycleState
): boolean {
  if (candidate !== "armed" && candidate !== "triggered") return false;
  if (fromState == null) return true;
  if (isTerminalPlaybookState(fromState)) return true;
  return false;
}

export type ResolvedEpisodeInstance = {
  instance_id: string;
  from_state: PlaybookLifecycleState;
  spawned: boolean;
  episode_direction: EpisodeDirectionKey;
};

/**
 * Resolve which durable instance row a matcher tick should update.
 * Spawns a new episode after invalidation/close or when direction diverges.
 */
export function resolveEpisodeInstance(
  sessionDate: string,
  v: PlaybookMatchVerdict,
  snapshots: readonly PlaybookInstanceSnapshot[],
  nowMs: number
): ResolvedEpisodeInstance {
  const candidate = verdictCandidateState(v);
  const verdictDirKey = episodeDirectionKey(v.direction);

  const activeForPb = snapshots.filter(
    (s) =>
      s.playbook_id === v.playbook_id &&
      isActiveEpisodeState(s.state) &&
      directionsCompatible(s.episode_direction, s.direction, v.direction)
  );

  if (activeForPb.length > 0) {
    const active = activeForPb.reduce((best, cur) =>
      cur.episode_start_ms >= best.episode_start_ms ? cur : best
    );
    return {
      instance_id: active.instance_id,
      from_state: active.state,
      spawned: false,
      episode_direction: active.episode_direction,
    };
  }

  if (!shouldSpawnEpisode(undefined, candidate)) {
    const legacy = legacyPlaybookInstanceId(sessionDate, v.playbook_id);
    const legacyRow = snapshots.find((s) => s.instance_id === legacy);
    return {
      instance_id: legacy,
      from_state: legacyRow?.state ?? "idle",
      spawned: false,
      episode_direction: verdictDirKey,
    };
  }

  const episodeStartMs = nowMs;
  return {
    instance_id: playbookInstanceId(sessionDate, v.playbook_id, verdictDirKey, episodeStartMs),
    from_state: "idle",
    spawned: true,
    episode_direction: verdictDirKey,
  };
}

/** Active episode for primary playbook + direction (engine + blocked paths). */
export function findActiveEpisodeInstanceId(
  snapshots: readonly PlaybookInstanceSnapshot[],
  playbookId: PlaybookId,
  direction: "long" | "short" | null
): string | null {
  const matches = snapshots.filter(
    (s) =>
      s.playbook_id === playbookId &&
      isActiveEpisodeState(s.state) &&
      directionsCompatible(s.episode_direction, s.direction, direction)
  );
  if (!matches.length) return null;
  const best = matches.reduce((a, b) => (a.episode_start_ms >= b.episode_start_ms ? a : b));
  return best.instance_id;
}
