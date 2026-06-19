import { readFile } from "fs/promises";
import path from "path";
import { requireTierApi } from "@/lib/market-api-auth";

export const dynamic = "force-dynamic";

const PLAYBOOK_PATH = path.join(
  process.cwd(),
  "private",
  "docs",
  "SPX-Sniper-Playbook.docx"
);

/** Premium-gated download — playbook is not served from public/. */
export async function GET() {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  try {
    const buffer = await readFile(PLAYBOOK_PATH);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="SPX-Sniper-Playbook.docx"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Playbook not available" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}
