import { NextRequest, NextResponse } from "next/server";
import { runFlowIngest } from "@/lib/providers/flow-ingest";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const q = req.nextUrl.searchParams.get("secret");

  if (!secret || (auth !== secret && q !== secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFlowIngest();
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/flow-ingest]", error);
    return NextResponse.json({ ok: false, error: "Ingest failed", detail }, { status: 500 });
  }
}
