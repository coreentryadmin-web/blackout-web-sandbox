import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { buildOccContractId, contractLabel } from "@/lib/helix/occ-contract-id";
import {
  fetchUwOptionContractFlow,
  fetchUwOptionContractIntraday,
  fetchUwOptionContractVolumeProfile,
} from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { serverCache, TTL } from "@/lib/server-cache";
import {
  parseContractFills,
  parseContractIntraday,
  parseContractMeta,
  volumeProfileBidAskPct,
} from "@/lib/helix/contract-drilldown-parse";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!uwConfigured()) {
    return NextResponse.json({ error: "UW not configured" }, { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") ?? "").toUpperCase();
  const expiry = sp.get("expiry") ?? "";
  const strike = Number(sp.get("strike"));
  const optionTypeRaw = (sp.get("option_type") ?? "").toUpperCase();
  const optionType = optionTypeRaw === "PUT" ? "PUT" : optionTypeRaw === "CALL" ? "CALL" : null;

  if (!ticker || !expiry || !optionType || !Number.isFinite(strike) || strike <= 0) {
    return NextResponse.json({ error: "ticker, expiry, strike, option_type required" }, { status: 400 });
  }

  const contractId = buildOccContractId(ticker, expiry, optionType, strike);
  if (!contractId) {
    return NextResponse.json({ error: "Invalid contract parameters" }, { status: 400 });
  }

  const cacheKey = `helix:contract:${contractId}`;
  try {
    const payload = await serverCache(cacheKey, TTL.DARK_POOL, async () => {
      const [flow, intraday, volume_profile] = await Promise.all([
        fetchUwOptionContractFlow(contractId, 40),
        fetchUwOptionContractIntraday(contractId, 60),
        fetchUwOptionContractVolumeProfile(contractId),
      ]);

      const flowRows = Array.isArray(flow) ? flow : [];
      const intradayRows = parseContractIntraday(Array.isArray(intraday) ? intraday : []);
      const fillRows = parseContractFills(flowRows);
      const meta = parseContractMeta(flowRows);

      return {
        contract_id: contractId,
        label: contractLabel(ticker, strike, optionType, expiry),
        ticker,
        strike,
        expiry: expiry.slice(0, 10),
        option_type: optionType,
        intraday: intradayRows,
        fills: fillRows,
        volume_profile,
        contract_meta: meta,
        bid_share_pct: volumeProfileBidAskPct(volume_profile),
        fill_count: fillRows.length,
      };
    });

    return NextResponse.json(roundFloats(payload));
  } catch (err) {
    console.error("[market/option-contract]", contractId, err);
    return NextResponse.json({ error: "Contract drilldown unavailable" }, { status: 502 });
  }
}
