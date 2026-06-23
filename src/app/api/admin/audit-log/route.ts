import { NextRequest, NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { dbConfigured, dbQuery, ensureSchema } from "@/lib/db";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

export type AuditLogEntry = {
  id: number;
  actor_email: string | null;
  actor_user_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type AuditLogPayload = {
  entries: AuditLogEntry[];
  total: number;
  db: boolean;
  generated_at: string;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Single resolve: one getUser for both the gate and the read-audit actor.
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied as NextResponse;

  // Audit admin READ access to this sensitive dashboard (fire-and-forget;
  // logAdminAction swallows its own errors and never affects the response).
  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_view",
    detail: { path: "admin/audit-log" },
  });

  try {
    if (!dbConfigured()) {
      return NextResponse.json<AuditLogPayload>({
        entries: [],
        total: 0,
        db: false,
        generated_at: new Date().toISOString(),
      });
    }

    await ensureSchema();

    const url = new URL(req.url);
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50", 10));
    const actionFilter = url.searchParams.get("action")?.trim() || null;
    const actorFilter  = url.searchParams.get("actor")?.trim()  || null;

    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (actionFilter) {
      conditions.push(`action ILIKE $${filterParams.length + 1}`);
      filterParams.push(`%${actionFilter}%`);
    }
    if (actorFilter) {
      conditions.push(`actor_email ILIKE $${filterParams.length + 1}`);
      filterParams.push(`%${actorFilter}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const queryParams = [...filterParams, limit];

    const [rows, countRow] = await Promise.all([
      dbQuery<{
        id: number;
        actor_email: string | null;
        actor_user_id: string | null;
        action: string;
        detail: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id, actor_email, actor_user_id, action, detail, created_at
         FROM admin_audit_log
         ${where}
         ORDER BY created_at DESC
         LIMIT $${queryParams.length}`,
        queryParams
      ),
      dbQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM admin_audit_log ${where}`,
        filterParams
      ),
    ]);

    return NextResponse.json<AuditLogPayload>({
      entries: rows.rows.map((row) => ({
        ...row,
        created_at: (row.created_at as Date).toISOString(),
      })),
      total: parseInt(countRow.rows[0]?.count ?? "0", 10),
      db: true,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    recordAdminRouteError("admin/audit-log", error);
    return NextResponse.json({ error: "Failed to load audit log" }, { status: 502 });
  }
}
