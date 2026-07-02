import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getPlatformSnapshot, type PlatformServiceId } from "@/lib/platform";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

const VALID_SERVICES = new Set<PlatformServiceId>(["spx", "flows", "nighthawk", "largo"]);

/** Cross-service snapshot — SPX desk, flow tape, Night Hawk edition in one response. */
export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const sp = req.nextUrl.searchParams;
  const includeParam = sp.get("include");
  const include = includeParam
    ? (includeParam.split(",").map((s) => s.trim()) as PlatformServiceId[]).filter((s) =>
        VALID_SERVICES.has(s)
      )
    : undefined;
  const flowLimit = Number(sp.get("flow_limit") ?? 50);
  const fullEdition = sp.get("full_edition") === "1";

  try {
    const snapshot = await getPlatformSnapshot({ include, flowLimit, fullEdition });
    return NextResponse.json(roundFloats(snapshot), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[market/platform/snapshot]", error);
    return NextResponse.json({ error: "Platform snapshot failed" }, { status: 502 });
  }
}
