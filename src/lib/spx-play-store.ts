import {
  dbConfigured,
  ensureSchema,
  getMeta,
  setMeta,
} from "@/lib/db";
import { nextMemoryPlayId } from "@/lib/spx-play-memory-id";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import type { PlayCloseSnapshot } from "@/lib/spx-play-outcomes";

export type OpenPlayRow = {
  id: number;
  session_date: string;
  direction: SpxPlayDirection;
  entry_price: number;
  entry_score: number;
  stop: number | null;
  target: number | null;
  grade: string;
  headline: string;
  trim_done: boolean;
  mfe_pts: number;
  mae_pts: number;
  opened_at: string;
  status: "open" | "closed";
  option_strike?: number | null;
  option_type?: string | null;
  option_label?: string | null;
  option_premium?: string | null;
};

export type PlaySessionMeta = {
  last_buy_at: number | null;
  last_sell_at: number | null;
  last_sell_was_loss: boolean;
  last_direction: SpxPlayDirection | null;
  last_stop_at: number | null;
  // C5: date boundary — prevents stale session data from bleeding across calendar days.
  session_date?: string;
  version?: number;
};

const SESSION_META_KEY = "spx_play_session_meta";
const MEMORY_OPEN: { row: OpenPlayRow | null } = { row: null };
// C2: in-memory race guard — prevents two concurrent evaluators from both
// calling openPlay() when dbConfigured() is false.
let memoryOpenInProgress = false;
const MEMORY_SESSION: PlaySessionMeta = {
  last_buy_at: null,
  last_sell_at: null,
  last_sell_was_loss: false,
  last_direction: null,
  last_stop_at: null,
};

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

async function setMetaWithRetry(key: string, value: string, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await setMeta(key, value);
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        // 50ms/100ms — short enough to stay well within serverless timeout budgets
        // (the original 150/400 cut too deeply into a 10s Lambda on a DB-hiccup day).
        await new Promise((r) => setTimeout(r, i === 0 ? 50 : 100));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to persist session meta");
}

export async function loadPlaySessionMeta(): Promise<PlaySessionMeta> {
  if (!dbConfigured()) return { ...MEMORY_SESSION };
  const raw = await getMeta(SESSION_META_KEY);
  if (!raw) {
    // Recovery: if there's an open play but no session meta at all, a crash
    // occurred between openPlay() and recordBuy(). Back-fill last_buy_at from
    // the play's opened_at so buy-cooldown protection is not bypassed, and
    // persist the corrected meta immediately.
    const openRow = await loadOpenPlay();
    if (openRow) {
      const backilledAt = new Date(openRow.opened_at).getTime();
      const recovered: PlaySessionMeta = {
        last_buy_at: backilledAt,
        last_sell_at: null,
        last_sell_was_loss: false,
        last_direction: openRow.direction,
        last_stop_at: null,
        version: 1,
      };
      Object.assign(MEMORY_SESSION, recovered);
      console.warn(
        "[spx-play-store] session meta missing but open play found — back-filling last_buy_at from opened_at and persisting"
      );
      // Fire-and-forget persist so the next read doesn't need to recover again.
      void setMetaWithRetry(SESSION_META_KEY, JSON.stringify(recovered)).catch((err) =>
        console.error("[spx-play-store] crash-recovery persist failed:", err)
      );
      // Strip internal version before returning to callers.
      const { version: _version, ...memFields } = recovered;
      void _version;
      return memFields;
    }
    return { last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null, last_stop_at: null };
  }
  try {
    const p = JSON.parse(raw) as PlaySessionMeta;
    const meta = {
      last_buy_at: p.last_buy_at ?? null,
      last_sell_at: p.last_sell_at ?? null,
      last_sell_was_loss: Boolean(p.last_sell_was_loss),
      last_direction: p.last_direction ?? null,
      last_stop_at: p.last_stop_at ?? null,
      session_date: p.session_date,
      version: typeof p.version === "number" ? p.version : 0,
    };

    // C5: date boundary check — if the persisted session_date is absent or
    // does not match today's ET date, the data is stale (e.g. loaded after
    // overnight restart). Reset the fields that cause re-entry locks to avoid
    // false positives on the next trading day. Keep last_buy_at so the
    // existing cooldown-timer logic handles it independently.
    if (!meta.session_date || meta.session_date !== todayEt()) {
      meta.last_sell_was_loss = false;
      meta.last_direction = null;
      meta.last_stop_at = null;
    }

    // Recovery: if meta was persisted but last_buy_at is null while an open
    // play exists, a crash occurred between openPlay() and recordBuy().
    // Back-fill last_buy_at from the play's opened_at to restore cooldown
    // protection for the rest of the session, and persist so this only fires
    // once per incident.
    if (meta.last_buy_at == null) {
      const openRow = await loadOpenPlay();
      if (openRow) {
        meta.last_buy_at = new Date(openRow.opened_at).getTime();
        console.warn(
          "[spx-play-store] last_buy_at null with open play present — back-filling from opened_at (crash recovery)"
        );
        const patched = { ...meta, version: meta.version + 1 };
        void setMetaWithRetry(SESSION_META_KEY, JSON.stringify(patched)).catch((err) =>
          console.error("[spx-play-store] crash-recovery patch persist failed:", err)
        );
      }
    }

    Object.assign(MEMORY_SESSION, meta);
    return meta;
  } catch {
    return { last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null, last_stop_at: null };
  }
}

function maxTimestamp(a: number | null, b: number | null): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}

function mergeSessionMeta(existing: PlaySessionMeta, incoming: PlaySessionMeta): PlaySessionMeta {
  return {
    last_buy_at: maxTimestamp(existing.last_buy_at, incoming.last_buy_at),
    last_sell_at: maxTimestamp(existing.last_sell_at, incoming.last_sell_at),
    last_stop_at: maxTimestamp(existing.last_stop_at, incoming.last_stop_at),
    last_sell_was_loss:
      incoming.last_sell_at != null && incoming.last_sell_at >= (existing.last_sell_at ?? 0)
        ? incoming.last_sell_was_loss
        : existing.last_sell_was_loss,
    last_direction: incoming.last_direction ?? existing.last_direction,
    // C5: always carry today's date forward so the reader can detect stale data.
    session_date: todayEt(),
  };
}

export async function savePlaySessionMeta(meta: PlaySessionMeta): Promise<void> {
  // BUG-07 fix: All attempts use the same merge strategy — read current DB
  // value, merge only the fields this writer owns, and write back. On the
  // third (final) attempt we no longer fall through to an unconditional write;
  // instead we do one last re-read-and-merge so we never overwrite fields that
  // a concurrent writer updated between our read and our write.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await loadPlaySessionMeta();
    const existingVersion = existing.version ?? 0;
    const merged = mergeSessionMeta(existing, meta);
    const payload: PlaySessionMeta = { ...merged, version: existingVersion + 1 };
    const json = JSON.stringify(payload);

    if (dbConfigured()) {
      const raw = await getMeta(SESSION_META_KEY);
      if (raw) {
        try {
          const current = JSON.parse(raw) as PlaySessionMeta;
          const currentVersion = current.version ?? 0;
          if (currentVersion > existingVersion) {
            // Another writer has advanced the version since our read.
            // On attempts 0 and 1 we retry immediately; on attempt 2 we do a
            // final merge against the freshly-read current value rather than
            // overwriting it blindly.
            if (attempt < 2) continue;

            // Attempt 2 — merge our incoming changes onto the latest DB state
            // so neither writer's updates are lost.
            const latestMerged = mergeSessionMeta(current, meta);
            const latestPayload: PlaySessionMeta = {
              ...latestMerged,
              version: currentVersion + 1,
            };
            await setMetaWithRetry(SESSION_META_KEY, JSON.stringify(latestPayload));
            const { version: _v2, ...memoryMeta2 } = latestPayload;
            void _v2;
            Object.assign(MEMORY_SESSION, memoryMeta2);
            return;
          }
        } catch {
          /* proceed with write */
        }
      }
      await setMetaWithRetry(SESSION_META_KEY, json);
    }

    const { version: _v, ...memoryMeta } = payload;
    void _v;
    Object.assign(MEMORY_SESSION, memoryMeta);
    return;
  }
}

export async function loadOpenPlay(): Promise<OpenPlayRow | null> {
  if (!dbConfigured()) return MEMORY_OPEN.row;

  await ensureSchema();
  const { fetchOpenSpxPlay } = await import("@/lib/db");
  const row = await fetchOpenSpxPlay(todayEt());
  MEMORY_OPEN.row = row;
  return row;
}

export async function openPlay(
  row: Omit<OpenPlayRow, "id" | "status" | "trim_done" | "mfe_pts" | "mae_pts">
): Promise<{ row: OpenPlayRow; created: boolean }> {
  const full: OpenPlayRow = {
    ...row,
    id: nextMemoryPlayId(),
    trim_done: false,
    mfe_pts: 0,
    mae_pts: 0,
    status: "open",
  };

  if (!dbConfigured()) {
    // C2: guard against double-entry from concurrent evaluators in the
    // in-memory path. If another call is already mid-open, return the
    // existing row as if it was already created (not a new open).
    if (memoryOpenInProgress) {
      return { row: MEMORY_OPEN.row ?? full, created: false };
    }
    memoryOpenInProgress = true;
    try {
      MEMORY_OPEN.row = full;
      return { row: full, created: true };
    } finally {
      memoryOpenInProgress = false;
    }
  }

  const { insertOpenSpxPlay } = await import("@/lib/db");
  const { id, created } = await insertOpenSpxPlay(full);
  const persisted = { ...full, id };
  MEMORY_OPEN.row = persisted;
  return { row: persisted, created };
}

export async function updateOpenPlay(
  id: number,
  patch: Partial<Pick<OpenPlayRow, "stop" | "target" | "trim_done" | "mfe_pts" | "mae_pts">>
): Promise<void> {
  if (MEMORY_OPEN.row?.id === id) {
    MEMORY_OPEN.row = { ...MEMORY_OPEN.row, ...patch };
  }
  if (!dbConfigured()) return;
  const { updateOpenSpxPlayRow } = await import("@/lib/db");
  await updateOpenSpxPlayRow(id, patch);
}

export async function closeOpenPlay(
  id: number,
  outcome: {
    was_loss: boolean;
    direction: SpxPlayDirection;
    close?: PlayCloseSnapshot;
  }
): Promise<void> {
  const exitAction = outcome.close?.exit_action;
  const meta = await loadPlaySessionMeta();
  const newMeta: PlaySessionMeta = {
    last_buy_at: meta.last_buy_at,
    last_sell_at: Date.now(),
    last_sell_was_loss: outcome.was_loss,
    last_direction: outcome.direction,
    // TRAIL exits do NOT trigger the 15-min stop cooldown by design — a trailing stop
    // on a +8pt or +15pt MFE trade is a protected exit from a winning setup, not the
    // chop/structure-break scenario the cooldown guards against. Exception: if the trail
    // somehow fired at a loss (rare slippage), treat it like a hard stop.
    last_stop_at:
      exitAction === "STOP" ||
      (exitAction === "TRAIL" && (outcome.close?.pnl_pts ?? 0) < 0)
        ? Date.now()
        : meta.last_stop_at,
  };

  if (dbConfigured()) {
    // Wrap all 4 writes (close outcome, close play row, meta save) in a single
    // DB transaction so a crash cannot leave the play open while meta reflects
    // it as closed (BUG-05 — post-loss re-entry protection bypass).
    const { dbClient } = await import("@/lib/db");
    const client = await dbClient();
    try {
      await client.query("BEGIN");

      if (outcome.close) {
        const { recordPlayClose } = await import("@/lib/spx-play-outcomes");
        await recordPlayClose(id, outcome.close, client);
      }

      const { closeOpenSpxPlayRow } = await import("@/lib/db");
      await closeOpenSpxPlayRow(id, client);

      const metaPayload: PlaySessionMeta = {
        ...newMeta,
        version: (meta.version ?? 0) + 1,
      };
      const { setMeta: setMetaFn } = await import("@/lib/db");
      await setMetaFn(SESSION_META_KEY, JSON.stringify(metaPayload), client);

      await client.query("COMMIT");

      MEMORY_OPEN.row = null;
      const { version: _v, ...memoryMeta } = metaPayload;
      void _v;
      Object.assign(MEMORY_SESSION, memoryMeta);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    // No DB — update in-memory state directly.
    if (outcome.close) {
      const { recordPlayClose } = await import("@/lib/spx-play-outcomes");
      await recordPlayClose(id, outcome.close);
    }
    MEMORY_OPEN.row = null;
    await savePlaySessionMeta(newMeta);
  }
}

export async function recordBuy(direction: SpxPlayDirection): Promise<void> {
  const meta = await loadPlaySessionMeta();
  // C3: idempotency guard — if a buy was already recorded within the last 30s
  // (e.g. due to a double-entry race from C2), skip to avoid wiping
  // last_sell_was_loss a second time and firing duplicate side effects.
  if (meta.last_buy_at != null && Date.now() - meta.last_buy_at < 30_000) {
    return;
  }
  await savePlaySessionMeta({
    ...meta,
    last_buy_at: Date.now(),
    last_direction: direction,
    last_sell_was_loss: false,
  });
}
