import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getAgentConfig } from "@/lib/nighthawk/agent-config";
import type { HuntMode, HuntRequest, HuntResponse } from "@/lib/nighthawk/types";

export const dynamic = "force-dynamic";

const VALID_MODES: HuntMode[] = ["day", "swing", "leap"];

export async function POST(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  let body: HuntRequest;
  try {
    body = (await req.json()) as HuntRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.mode || !VALID_MODES.includes(body.mode)) {
    return NextResponse.json({ error: "Invalid hunt mode" }, { status: 400 });
  }

  const config = getAgentConfig(body.mode);
  const filters = body.filters ?? {};

  const response: HuntResponse = {
    status: "queued",
    mode: body.mode,
    scanned_at: new Date().toISOString(),
    message: `${config.title} agent armed with your filters. Full scan pipeline ships next — dossier + scoring + Claude synthesis.`,
    plays: [],
  };

  console.info("[nighthawk/hunt]", {
    mode: body.mode,
    filters,
    userId: authResult.userId,
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
