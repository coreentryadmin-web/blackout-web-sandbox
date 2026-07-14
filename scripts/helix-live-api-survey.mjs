#!/usr/bin/env node
/**
 * HELIX live API survey — staging market routes + UW contract endpoints.
 * Writes audit-output/helix-live-api-survey.json
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const UW_BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const UW_KEY = (process.env.UW_API_KEY ?? "").trim();
const OUT_DIR = join(process.cwd(), "audit-output");
mkdirSync(OUT_DIR, { recursive: true });

function loadStagingSecret() {
  const name = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${name}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

function sampleKeys(obj, depth = 0) {
  if (obj == null || depth > 2) return typeof obj;
  if (Array.isArray(obj)) {
    return obj.length ? { _array: sampleKeys(obj[0], depth + 1), length: obj.length } : [];
  }
  if (typeof obj !== "object") return typeof obj;
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 40)) {
    if (Array.isArray(v)) out[k] = { _array: v.length ? sampleKeys(v[0], depth + 1) : "empty", len: v.length };
    else if (v && typeof v === "object") out[k] = sampleKeys(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

async function fetchJson(url, headers = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store" });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 400) };
  }
  return { status: res.status, ms: Date.now() - t0, body };
}

async function uwGet(path, params = {}) {
  if (!UW_KEY) return { skip: true, reason: "UW_API_KEY missing" };
  const qs = new URLSearchParams(params);
  const url = `${UW_BASE}${path}${qs.size ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${UW_KEY}`, Accept: "application/json" } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 400) };
  }
  const rows = body?.data ?? body?.rows ?? (Array.isArray(body) ? body : null);
  return { status: res.status, path, rows: Array.isArray(rows) ? rows : null, body };
}

function buildOcc(ticker, expiry, type, strike) {
  const root = ticker.toUpperCase() === "SPX" ? "SPXW" : ticker.toUpperCase();
  const [y, m, d] = expiry.slice(0, 10).split("-");
  const date = `${y.slice(2)}${m}${d}`;
  const cp = type.toUpperCase() === "PUT" ? "P" : "C";
  const strikeInt = Math.round(strike * 1000);
  return `${root}${date}${cp}${String(strikeInt).padStart(8, "0")}`;
}

async function main() {
  const report = { at: new Date().toISOString(), base: BASE, endpoints: {} };

  let secret = {};
  try {
    secret = loadStagingSecret();
    if (secret.UW_API_KEY && !process.env.UW_API_KEY) process.env.UW_API_KEY = secret.UW_API_KEY;
  } catch (e) {
    report.secretError = e.message;
  }

  const cron = secret.CRON_SECRET?.trim() ?? process.env.CRON_SECRET?.trim();
  const cronH = cron ? { Authorization: `Bearer ${cron}` } : {};

  let memberH = {};
  try {
    const session = await mintAppSession({ appUrl: BASE, secret });
    if (session.skip) report.auth = { skip: true, reason: session.reason };
    else {
      memberH = { Cookie: session.cookieHeader };
      report.auth = { via: session.via ?? "cognito", provisioned: session.provisioned ?? false };
      if (session.cleanup) await session.cleanup();
    }
  } catch (e) {
    report.auth = { error: e.message };
  }

  const stagingRoutes = [
    ["/api/market/flows?limit=8&min_premium=200000", "flows_tape", memberH],
    ["/api/market/dark-pool?limit=5", "dark_pool", memberH],
    ["/api/market/anomalies", "anomalies", memberH],
    ["/api/market/earnings-calendar", "earnings", cronH],
    ["/api/market/flow-brief?ticker=NVDA", "flow_brief", memberH],
    ["/api/market/nighthawk/edition", "nighthawk_edition", memberH],
  ];

  for (const [path, key, headers] of stagingRoutes) {
    const r = await fetchJson(`${BASE}${path}`, headers);
    const flows = r.body?.flows ?? r.body?.prints ?? r.body?.anomalies;
    const sample = Array.isArray(flows) ? flows[0] : r.body;
    report.endpoints[key] = {
      path,
      status: r.status,
      ms: r.ms,
      count: Array.isArray(flows) ? flows.length : r.body?.count ?? null,
      sample: sampleKeys(sample),
      topLevelKeys: r.body && typeof r.body === "object" ? Object.keys(r.body) : null,
    };
  }

  const flow0 = report.endpoints.flows_tape?.sample;
  let contractId = null;
  if (report.endpoints.flows_tape?.count > 0) {
    const full = await fetchJson(`${BASE}/api/market/flows?limit=3`, memberH);
    const f = full.body?.flows?.[0];
    if (f?.ticker && f?.strike && f?.expiry && f?.option_type) {
      contractId = buildOcc(f.ticker, f.expiry, f.option_type, f.strike);
      const qs = new URLSearchParams({
        ticker: f.ticker,
        strike: String(f.strike),
        expiry: f.expiry.slice(0, 10),
        option_type: f.option_type.toUpperCase(),
      });
      const drill = await fetchJson(`${BASE}/api/market/option-contract?${qs}`, memberH);
      report.endpoints.contract_drilldown_staging = {
        contract_id: contractId,
        from_flow: { ticker: f.ticker, strike: f.strike, expiry: f.expiry, option_type: f.option_type, premium: f.premium },
        status: drill.status,
        ms: drill.ms,
        fill_count: drill.body?.fill_count,
        intraday_len: drill.body?.intraday?.length,
        fills_sample: sampleKeys(drill.body?.fills?.[0]),
        intraday_sample: sampleKeys(drill.body?.intraday?.[0]),
        volume_profile_keys: drill.body?.volume_profile && typeof drill.body.volume_profile === "object"
          ? Object.keys(drill.body.volume_profile)
          : null,
        chain_ratio: drill.body?.chain_ratio,
      };
    }
  }

  const uwKey = process.env.UW_API_KEY?.trim();
  if (uwKey) {
    const uwPaths = [
      ["/api/option-trades/flow-alerts", { limit: 5, min_premium: 200000 }],
      ["/api/darkpool/recent", { limit: 5 }],
      ["/api/market/market-tide", {}],
    ];
    for (const [path, params] of uwPaths) {
      const r = await uwGet(path, params);
      report.endpoints[`uw${path.replace(/\//g, "_")}`] = {
        status: r.status,
        row_count: r.rows?.length ?? 0,
        sample: sampleKeys(r.rows?.[0] ?? r.body),
      };
    }

    const cid = contractId ?? "NVDA260620C00120000";
    for (const suffix of ["flow", "intraday", "volume-profile"]) {
      const r = await uwGet(`/api/option-contract/${cid}/${suffix}`, suffix === "intraday" ? { limit: 10 } : { limit: 10 });
      report.endpoints[`uw_contract_${suffix.replace("-", "_")}`] = {
        contract_id: cid,
        status: r.status,
        row_count: r.rows?.length ?? null,
        sample: sampleKeys(r.rows?.[0] ?? r.body),
        body_keys: r.body && typeof r.body === "object" && !r.rows ? Object.keys(r.body).slice(0, 20) : null,
      };
    }
  }

  const outPath = join(OUT_DIR, "helix-live-api-survey.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
