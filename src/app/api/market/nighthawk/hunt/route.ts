import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { runDayTradeAgent } from "@/lib/nighthawk/agents";
import { getAgentConfig } from "@/lib/nighthawk/agent-config";
import { huntPlatformContext, runHuntScan } from "@/lib/nighthawk/hunt-builder";
import type { HuntMode, HuntRequest, HuntResponse } from "@/lib/nighthawk/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  console.info("[nighthawk/hunt] start", {
    mode: body.mode,
    filters,
    userId: authResult.userId,
  });

  const [scanResult, platform_context] = await Promise.all([
    body.mode === "day"
      ? runDayTradeAgent({ mode: "day", filters }).then((run) => ({
          ok: run.ok,
          plays: run.signals,
          message: run.message,
          candidates: run.candidates,
          error: run.error,
          duration_ms: run.duration_ms,
          spx_bias: run.spx_bias,
        }))
      : runHuntScan(body).then((scan) => ({ ...scan, spx_bias: null })),
    huntPlatformContext(),
  ]);

  const response: HuntResponse = {
    status: scanResult.ok ? "complete" : "error",
    mode: body.mode,
    scanned_at: new Date().toISOString(),
    message: scanResult.ok
      ? scanResult.message
      : scanResult.message || `${config.title} hunt finished without qualifying plays.`,
    plays: scanResult.plays,
    platform_context: {
      ...platform_context,
      spx_bias: scanResult.spx_bias ?? null,
    },
  };

  console.info("[nighthawk/hunt] done", {
    mode: body.mode,
    ok: scanResult.ok,
    plays: scanResult.plays.length,
    candidates: scanResult.candidates,
    duration_ms: scanResult.duration_ms,
    spx_bias: scanResult.spx_bias,
    userId: authResult.userId,
  });

  return NextResponse.json(response, {
    status: scanResult.ok ? 200 : 422,
    headers: { "Cache-Control": "no-store" },
  });
}
