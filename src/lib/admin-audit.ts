import { dbConfigured, ensureSchema, dbQuery } from "@/lib/db";

export async function logAdminAction(input: {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (!dbConfigured()) {
    console.info("[admin-audit]", input.action, input.detail ?? {});
    return;
  }
  try {
    await ensureSchema();
    await dbQuery(
      `INSERT INTO admin_audit_log (actor_user_id, actor_email, action, detail)
       VALUES ($1, $2, $3, $4)`,
      [
        input.actorUserId ?? null,
        input.actorEmail ?? null,
        input.action,
        JSON.stringify(input.detail ?? {}),
      ]
    );
  } catch (err) {
    console.warn("[admin-audit]", err);
  }
}
