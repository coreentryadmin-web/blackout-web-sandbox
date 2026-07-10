#!/usr/bin/env node
/**
 * Staging playbook shadow validation — proves named playbooks surface on /api/market/spx/play.
 */
import { execSync } from "node:child_process";
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";

function loadStagingSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

async function resolveAuth() {
  const secret = loadStagingSecret();
  const cron = secret.CRON_SECRET?.trim();
  if (cron) return { bearer: cron, cookie: null, cleanup: null };

  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) return { skip: true, reason: session.reason };
  const cookie =
    session.cookieHeader ??
    session.cookies?.map((c) => `${c.name}=${c.value}`).join("; ") ??
    "";
  return { bearer: null, cookie, cleanup: session.cleanup ?? null };
}

async function main() {
  const auth = await resolveAuth();
  if (auth.skip) {
    console.error("SKIP:", auth.reason);
    process.exit(0);
  }

  const headers = { Accept: "application/json" };
  if (auth.bearer) headers.Authorization = `Bearer ${auth.bearer}`;
  if (auth.cookie) headers.Cookie = auth.cookie;

  const res = await fetch(`${BASE}/api/market/spx/play`, { headers, cache: "no-store" });
  const body = await res.json().catch(() => ({}));

  const failures = [];
  if (res.status !== 200) failures.push(`play HTTP ${res.status}`);
  if (body?.playbook_shadow?.mode !== "live") failures.push("playbook_shadow.mode !== live on staging");
  if (!Array.isArray(body?.playbook_shadow?.verdicts) || body.playbook_shadow.verdicts.length < 14) {
    failures.push(`expected 14 verdicts, got ${body?.playbook_shadow?.verdicts?.length ?? 0}`);
  }

  const fired = (body?.playbook_shadow?.verdicts ?? []).filter((v) => v.trigger_fired);
  console.log(`action=${body?.action} score=${body?.score} primary=${body?.playbook_shadow?.primary_playbook_id ?? "none"}`);
  for (const v of body?.playbook_shadow?.verdicts ?? []) {
    console.log(`  ${v.playbook_id} fired=${v.trigger_fired} eligible=${v.regime_eligible} primary=${v.primary}`);
  }
  console.log(`fired_count=${fired.length}`);

  if (auth.cleanup) await auth.cleanup();

  if (failures.length) {
    console.error("FAIL:", failures.join("; "));
    process.exit(1);
  }
  console.log("PASS: staging playbook shadow");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
