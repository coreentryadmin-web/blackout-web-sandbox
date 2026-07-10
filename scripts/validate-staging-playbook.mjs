#!/usr/bin/env node
/**
 * Staging playbook shadow validation — proves named playbooks surface on /api/market/spx/play.
 */
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");

async function main() {
  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(0);
  }

  const cookie = session.cookies?.map((c) => `${c.name}=${c.value}`).join("; ") ?? "";
  const res = await fetch(`${BASE}/api/market/spx/play`, {
    headers: { Accept: "application/json", Cookie: cookie },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));

  const failures = [];
  if (res.status !== 200) failures.push(`play HTTP ${res.status}`);
  if (body?.playbook_shadow?.mode !== "shadow") failures.push("playbook_shadow.mode !== shadow");
  if (!Array.isArray(body?.playbook_shadow?.verdicts) || body.playbook_shadow.verdicts.length < 14) {
    failures.push(`expected 14 verdicts, got ${body?.playbook_shadow?.verdicts?.length ?? 0}`);
  }

  const fired = (body?.playbook_shadow?.verdicts ?? []).filter((v) => v.trigger_fired);
  console.log(`action=${body?.action} score=${body?.score} primary=${body?.playbook_shadow?.primary_playbook_id ?? "none"}`);
  for (const v of body?.playbook_shadow?.verdicts ?? []) {
    console.log(`  ${v.playbook_id} fired=${v.trigger_fired} eligible=${v.regime_eligible} primary=${v.primary}`);
  }
  console.log(`fired_count=${fired.length}`);

  if (session.cleanup) await session.cleanup();

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
