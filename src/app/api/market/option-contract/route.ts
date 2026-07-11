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
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseIntraday(rows: unknown[]) {
  return rows
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const ts = String(r.timestamp ?? r.time ?? r.date ?? r.start_time ?? r.t ?? "");
      return {
        time: ts,
        volume: num(r.volume ?? r.total_volume ?? r.vol ?? r.contract_volume),
        oi: num(r.open_interest ?? r.oi ?? r.openInterest),
        premium: num(r.premium ?? r.total_premium),
      };
    })
    .filter((row) => row.time || row.volume > 0 || row.oi > 0);
}

function parseFills(rows: unknown[]) {
  return rows
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const fill = num(r.price ?? r.fill_price ?? r.avg_fill ?? r.nbbo_ask);
      return {
        time: String(r.created_at ?? r.executed_at ?? r.timestamp ?? r.start_time ?? ""),
        premium: num(r.premium ?? r.total_premium),
        size: num(r.size ?? r.volume ?? r.trade_count ?? r.contracts),
        fill: fill > 0 ? fill : null,
        side: String(r.side ?? r.sentiment ?? "").toLowerCase(),
      };
    })
    .filter((row) => row.time || row.premium > 0);
}

function chainRatioFromProfile(profile: unknown): number | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  const direct = num(p.chain_ratio ?? p.chainRatio ?? p.ratio);
  if (direct > 0) return direct;
  const callVol = num(p.call_volume ?? p.callVolume);
  const putVol = num(p.put_volume ?? p.putVolume);
  const total = callVol + putVol;
  if (total <= 0) return null;
  return Math.round((callVol / total) * 1000) / 10;
}

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

      const intradayRows = parseIntraday(Array.isArray(intraday) ? intraday : []);
      const fillRows = parseFills(Array.isArray(flow) ? flow : []);

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
        chain_ratio: chainRatioFromProfile(volume_profile),
        fill_count: fillRows.length,
      };
    });

    return NextResponse.json(roundFloats(payload));
  } catch (err) {
    console.error("[market/option-contract]", contractId, err);
    return NextResponse.json({ error: "Contract drilldown unavailable" }, { status: 502 });
  }
}
