import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const endpoint = req.nextUrl.searchParams.get("endpoint") ?? "/api/congress/trades";
  const UW_BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
  const UW_KEY = process.env.UW_API_KEY ?? "";
  const UW_CID = process.env.UW_CLIENT_API_ID ?? "100001";

  // SSRF guard: this request carries the UW_KEY in the Authorization header, so the target host
  // MUST stay the UW base. Resolve `endpoint` against the base via the URL parser (a bare path
  // stays on the UW host) and reject anything that lands on another host — e.g. an absolute URL,
  // a protocol-relative "//evil.com", or a "@evil.com" userinfo trick — which would otherwise
  // exfiltrate the API key. (Route is admin-gated above; this is defense-in-depth.)
  let target: URL;
  let baseHost: string;
  try {
    baseHost = new URL(UW_BASE).host;
    target = new URL(endpoint, `${UW_BASE}/`);
  } catch {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }
  if (target.host !== baseHost || target.protocol !== "https:") {
    return NextResponse.json(
      { error: "endpoint must be a path on the UW host", host: target.host },
      { status: 400 }
    );
  }
  target.searchParams.set("limit", "5");

  try {
    const url = target.toString();
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${UW_KEY}`,
        "UW-CLIENT-API-ID": UW_CID,
        Accept: "application/json",
      },
    });
    const text = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return NextResponse.json({ status: r.status, endpoint, raw: parsed });
  } catch (e) {
    return NextResponse.json({ error: String(e), endpoint });
  }
}
