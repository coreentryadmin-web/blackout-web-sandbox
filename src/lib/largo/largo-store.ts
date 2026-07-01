import { dbClient, dbConfigured, dbQuery } from "@/lib/db";
import type { AnthropicMessage } from "@/lib/providers/anthropic";

export type LargoStoredMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools_used: string[];
  created_at: string;
};

const MAX_MESSAGES_LOAD = 28;
/** Max rows stored per session in Postgres (UI/Claude still use last MAX_MESSAGES_LOAD). */
const MAX_MESSAGES_STORED = 50;
const MAX_MEMORY_SESSIONS = 500;
const DEFAULT_RETENTION_DAYS = 7;
const memorySessions = new Map<string, AnthropicMessage[]>();
const memorySessionOwners = new Map<string, string>();

function touchMemorySession(sessionId: string, hist: AnthropicMessage[]): void {
  memorySessions.delete(sessionId);
  memorySessions.set(sessionId, hist);
  while (memorySessions.size > MAX_MEMORY_SESSIONS) {
    const oldest = memorySessions.keys().next().value;
    if (oldest) memorySessions.delete(oldest);
  }
}

export async function ensureLargoSession(sessionId: string, userId: string): Promise<void> {
  if (!dbConfigured()) return;
  // Atomic upsert: collapses check+insert+touch into one statement so two concurrent
  // requests for a brand-new session id can't both pass an existence check and race the
  // INSERT (the loser previously hit a 23505 primary-key violation surfaced as a 500).
  // ON CONFLICT only touches updated_at (title intentionally left unset on insert, matching
  // prior behavior); RETURNING user_id is the existing owner on conflict, so we assert
  // ownership against it exactly as before. Do NOT add user_id to the DO UPDATE SET — that
  // would let a second user silently hijack someone else's session.
  const upserted = await dbQuery<{ user_id: string }>(
    `INSERT INTO largo_sessions (id, user_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
     RETURNING user_id`,
    [sessionId, userId]
  );
  if (upserted.rows[0]?.user_id !== userId) {
    throw new Error("Largo session not found");
  }
}

export async function sessionOwnedByUser(sessionId: string, userId: string): Promise<boolean> {
  if (!dbConfigured()) return true;
  const res = await dbQuery<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM largo_sessions WHERE id = $1 AND user_id = $2) AS ok`,
    [sessionId, userId]
  );
  return Boolean(res.rows[0]?.ok);
}

export async function fetchLargoHistory(
  sessionId: string,
  userId: string
): Promise<AnthropicMessage[]> {
  if (!dbConfigured()) {
    const owner = memorySessionOwners.get(sessionId);
    if (owner !== undefined && owner !== userId) return [];
    return memorySessions.get(sessionId) ?? [];
  }

  if (!(await sessionOwnedByUser(sessionId, userId))) {
    return [];
  }

  const res = await dbQuery<{ role: string; content: string }>(
    `SELECT role, content
     FROM largo_messages
     WHERE session_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, MAX_MESSAGES_LOAD]
  );

  // id tiebreaker keeps same-millisecond user/assistant rows in insert order
  // after reverse() — without it ties replayed out of order (LARGO-2).
  return res.rows.reverse().map((r) => ({
    role: r.role,
    content: r.content,
  }));
}

export async function fetchLargoMessagesPublic(
  sessionId: string,
  userId: string
): Promise<LargoStoredMessage[]> {
  if (!dbConfigured()) {
    // Owner check parity with fetchLargoHistory — without it, a premium user
    // could read another user's in-memory conversation in no-DB mode (LARGO-10).
    const owner = memorySessionOwners.get(sessionId);
    if (owner !== undefined && owner !== userId) return [];
    const rows = memorySessions.get(sessionId) ?? [];
    return rows.map((m, i) => ({
      id: i + 1,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      tools_used: [],
      created_at: new Date().toISOString(),
    }));
  }

  if (!(await sessionOwnedByUser(sessionId, userId))) return [];

  const res = await dbQuery<{
    id: number;
    role: string;
    content: string;
    tools_used: string[] | null;
    created_at: Date;
  }>(
    `SELECT id, role, content, tools_used, created_at
     FROM largo_messages
     WHERE session_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2`,
    [sessionId, MAX_MESSAGES_LOAD]
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    role: r.role as "user" | "assistant",
    content: r.content,
    tools_used: Array.isArray(r.tools_used) ? r.tools_used : [],
    created_at: new Date(r.created_at).toISOString(),
  }));
}

export async function appendLargoMessage(
  sessionId: string,
  userId: string,
  role: "user" | "assistant",
  content: string,
  toolsUsed: string[] = []
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

  if (!dbConfigured()) {
    const hist = memorySessions.get(sessionId) ?? [];
    if (!memorySessionOwners.has(sessionId)) memorySessionOwners.set(sessionId, userId);
    hist.push({ role, content: trimmed });
    if (hist.length > MAX_MESSAGES_LOAD) hist.splice(0, hist.length - MAX_MESSAGES_LOAD);
    touchMemorySession(sessionId, hist);
    return;
  }

  await ensureLargoSession(sessionId, userId);

  const client = await dbClient();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO largo_messages (session_id, role, content, tools_used)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [sessionId, role, trimmed, JSON.stringify(toolsUsed)]
    );

    await client.query(
      `DELETE FROM largo_messages
       WHERE session_id = $1
         AND id NOT IN (
           SELECT id FROM largo_messages
           WHERE session_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2
         )`,
      [sessionId, MAX_MESSAGES_STORED]
    );

    if (role === "user") {
      await client.query(
        `UPDATE largo_sessions
         SET updated_at = NOW(),
             title = COALESCE(title, LEFT($2, 120))
         WHERE id = $1 AND user_id = $3`,
        [sessionId, trimmed, userId]
      );
    } else {
      await client.query(
        `UPDATE largo_sessions SET updated_at = NOW() WHERE id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function largoSessionRetentionDays(): number {
  const raw = process.env.LARGO_SESSION_RETENTION_DAYS?.trim();
  const n = raw ? Number(raw) : DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.round(n), 365);
}

/** Remove Largo sessions inactive longer than retention (messages cascade). */
export async function purgeStaleLargoSessions(retentionDays = largoSessionRetentionDays()): Promise<{
  ok: boolean;
  retention_days: number;
  sessions_deleted: number;
  skipped?: boolean;
  reason?: string;
}> {
  if (!dbConfigured()) {
    return { ok: true, retention_days: retentionDays, sessions_deleted: 0, skipped: true, reason: "no_database" };
  }

  const res = await dbQuery<{ id: string }>(
    `DELETE FROM largo_sessions
     WHERE updated_at < NOW() - ($1::text || ' days')::interval
     RETURNING id`,
    [String(retentionDays)]
  );

  return {
    ok: true,
    retention_days: retentionDays,
    sessions_deleted: res.rowCount ?? res.rows.length,
  };
}
