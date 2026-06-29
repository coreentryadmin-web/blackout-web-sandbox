#!/usr/bin/env node
/**
 * Deep platform audit — production probes via CRON_SECRET + public APIs.
 * Usage: node scripts/deep-audit.mjs [--base=https://blackouttrades.com]
 */
const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET ?? "";

const findings = [];

function issue(severity, id, detail) {
  findings.push({ severity, id, detail });
  console.log(`[${severity}] ${id}: ${detail}`);
}

function pass(id, detail = "") {
  console.log(`[OK] ${id}${detail ? `: ${detail}` : ""}`);
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200), _status: res.status };
  }
  return { status: res.status, json };
}

async function cronGet(path) {
  return fetchJson(path, {
    headers: { Authorization: `Bearer ${CRON}` },
  });
}

async function main() {
  console.log(`\n=== Deep Audit ${BASE} ===\n`);

  if (!CRON) issue("P1", "ENV", "CRON_SECRET unset — cron probes skipped");

  // ── Track record split-brain ──
  const pub = await fetchJson("/api/public/track-record");
  const page = await fetchJson("/api/track-record");
  if (pub.status === 200 && page.status === 200) {
    const p = pub.json;
    const t = page.json;
    if (p.available && p.total_closed > 0) {
      const pageTotal = (t.spxSlayer?.total ?? 0) + (t.nightHawk?.total ?? 0);
      if (pageTotal === 0) {
        issue(
          "P0",
          "TR-SPLIT",
          `/api/public/track-record has ${p.total_closed} closed plays but /api/track-record shows 0 — /track-record page empty, embed shows live stats`
        );
      } else pass("TR-CONSISTENT", `public=${p.total_closed} page=${pageTotal}`);
      // Math
      if (p.wins + p.losses + p.breakeven !== p.total_closed) {
        issue("P0", "TR-MATH", `public wins+losses+breakeven != total_closed`);
      }
    }
  }

  // ── Cron watchdog ──
  if (CRON) {
    const wd = await cronGet("/api/cron/cron-staleness-watchdog");
    if (wd.status === 200) {
      const p = wd.json;
      if (p.problems > 0) {
        issue("P1", "CRON-STALE", `Stale/missing crons: ${(p.problem_keys ?? []).join(", ")}`);
      } else pass("CRON-WATCHDOG", `${p.checked} jobs OK`);
    }

    const dc = await cronGet("/api/cron/data-correctness?force=1");
    if (dc.status === 200) {
      const p = dc.json;
      if (p.flags?.length) {
        for (const f of p.flags.slice(0, 10)) {
          issue("P0", "DATA-FLAG", `[${f.layer}/${f.metric}] ${f.detail}`);
        }
      } else pass("DATA-CORRECTNESS", `${p.totals?.flags ?? 0} flags, ${p.totals?.independentlyConfirmed ?? 0} oracle-confirmed`);
      if (p.market_open === false && p.totals?.independentlyConfirmed === 0) {
        issue("P2", "DATA-COV", `Off-hours run: 0 independently-confirmed metrics (${p.coverage_gaps} consistency-only gaps)`);
      }
    }

    const di = await cronGet("/api/cron/data-integrity?force=1");
    if (di.status === 200 && di.json.discrepancies > 0) {
      issue("P0", "DATA-INTEGRITY", `${di.json.discrepancies} cross-tool discrepancies`);
    } else if (di.status === 200) pass("DATA-INTEGRITY", "0 discrepancies");
  }

  // ── Public APIs numeric ──
  const regime = await fetchJson("/api/market/regime");
  if (regime.status === 200) {
    const r = regime.json;
    if (!r.available) issue("P2", "REGIME", "regime unavailable");
    else pass("REGIME", `${r.regime} gex=${r.gexRegime}`);
  }

  const health = await fetchJson("/api/health");
  pass("HEALTH", `HTTP ${health.status} ok=${health.json.ok}`);

  // ── Auth gates (premium must 401 unauthenticated) ──
  const gated = [
    "/api/market/spx/desk",
    "/api/market/flows",
    "/api/market/heatmap?ticker=SPY",
    "/api/platform/intel",
    "/api/coaching/alerts",
    "/api/brief/premarket",
    "/api/admin/me",
  ];
  for (const path of gated) {
    const r = await fetchJson(path);
    if (r.status !== 401 && r.status !== 403) {
      issue("P0", "AUTH-LEAK", `${path} returned HTTP ${r.status} without session`);
    } else pass("AUTH-GATE", path);
  }

  // ── Clerk admin user sanity ──
  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (clerkKey) {
    const res = await fetch("https://api.clerk.com/v1/users?query=coreentryadmin", {
      headers: { Authorization: `Bearer ${clerkKey}` },
    });
    const users = await res.json();
    const admin = users[0];
    if (admin) {
      const tier = admin.public_metadata?.tier;
      if (tier !== "premium") issue("P1", "CLERK-TIER", `Admin user tier=${tier} expected premium`);
      else pass("CLERK-ADMIN", `tier=${tier}`);
    }
  }

  // ── Cloudflare ──
  const cfToken = process.env.CF_API_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;
  if (cfToken && zoneId) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, {
      headers: { Authorization: `Bearer ${cfToken}` },
    });
    const d = await res.json();
    if (d.success) pass("CLOUDFLARE", `zone ${d.result.name} ${d.result.status}`);
    else issue("P2", "CLOUDFLARE", d.errors?.[0]?.message ?? "zone check failed");
  }

  console.log(`\n=== Summary: ${findings.length} issue(s) ===`);
  const bySev = {};
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
  console.log(bySev);
  process.exit(findings.some((f) => f.severity === "P0") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
