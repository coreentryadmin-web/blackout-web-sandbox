import { dbConfigured, dbQuery, ensureSchema } from "@/lib/db";
import type { AnthropicMessage } from "@/lib/providers/anthropic";

export type LargoStoredMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools_used: string[];
  created_at: string;
};

const MAX_MESSAGES_LOAD = 28;
const memorySessions = new Map<string, AnthropicMessage[]>();

export async function ensureLargoSession(sessionId: string, userId: string): Promise<void> {
  if (!dbConfigured()) return;
  await ensureSchema();
  const existing = await dbQuery<{ user_id: string }>(
    `SELECT user_id FROM largo_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!existing.rows.length) {
    await dbQuery(`INSERT INTO largo_sessions (id, user_id, updated_at) VALUES ($1, $2, NOW())`, [
      sessionId,
      userId,
    ]);
    return;
  }
  if (existing.rows[0].user_id !== userId) {
    throw new Error("Largo session not found");
  }
  await dbQuery(`UPDATE largo_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);
}

export async function sessionOwnedByUser(sessionId: string, userId: string): Promise<boolean> {
  if (!dbConfigured()) return true;
  await ensureSchema();
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
    return memorySessions.get(sessionId) ?? [];
  }

  if (!(await sessionOwnedByUser(sessionId, userId))) {
    return [];
  }

  const res = await dbQuery<{ role: string; content: string }>(
    `SELECT role, content
     FROM largo_messages
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [sessionId, MAX_MESSAGES_LOAD]
  );

  return res.rows.map((r) => ({
    role: r.role,
    content: r.content,
  }));
}

export async function fetchLargoMessagesPublic(
  sessionId: string,
  userId: string
): Promise<LargoStoredMessage[]> {
  if (!dbConfigured()) {
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
     ORDER BY created_at ASC
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
    hist.push({ role, content: trimmed });
    if (hist.length > MAX_MESSAGES_LOAD) hist.splice(0, hist.length - MAX_MESSAGES_LOAD);
    memorySessions.set(sessionId, hist);
    return;
  }

  await ensureLargoSession(sessionId, userId);

  await dbQuery(
    `INSERT INTO largo_messages (session_id, role, content, tools_used)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [sessionId, role, trimmed, JSON.stringify(toolsUsed)]
  );

  if (role === "user") {
    await dbQuery(
      `UPDATE largo_sessions
       SET updated_at = NOW(),
           title = COALESCE(title, LEFT($2, 120))
       WHERE id = $1 AND user_id = $3`,
      [sessionId, trimmed, userId]
    );
  } else {
    await dbQuery(`UPDATE largo_sessions SET updated_at = NOW() WHERE id = $1 AND user_id = $2`, [
      sessionId,
      userId,
    ]);
  }
}
