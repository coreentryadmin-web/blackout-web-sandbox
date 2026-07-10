#!/usr/bin/env node
/**
 * Staging SPX desk live validation — dual-poll API coherence for play chips,
 * live chain premiums, playbook panel, and desk spot freshness.
 *
 * Usage:
 *   npm run validate:staging-desk-live
 *   STAGING_BASE_URL=https://staging.blackouttrades.com node scripts/validate-staging-desk-live.mjs
 */
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const POLL_GAP_MS = Number(process.env.DESK_LIVE_POLL_GAP_MS ?? 5_000);
const MAX_AS_OF_AGE_SEC = Number(process.env.DESK_LIVE_MAX_AS_OF_SEC ?? 120);

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
}

function warn(msg) {
  warnings.push(msg);
  console.warn(`  ⚠ ${msg}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseOccStrike(raw) {
  if (!raw || typeof raw !== "string") return null;
  const occTail = raw.trim().match(/([CP])\s*(\d{4,5})\s*$/i);
  if (!occTail) return null;
  const strike = Number(occTail[2]);
  if (!Number.isFinite(strike) || strike < 1000 || strike > 99_999) return null;
  return strike;
}

function compactChipLabel(raw, direction, premium) {
  const strike = parseOccStrike(raw);
  const compact = raw?.match(/(\d{4,5})\s*([CP])\b/i);
  let label = null;
  if (compact) {
    label = `${compact[1]}${compact[2].toUpperCase()}`;
  } else if (strike) {
    label = `${strike}${direction === "short" ? "P" : "C"}`;
  }
  if (!label) return null;
  if (!premium) return label;
  const prem = String(premium).replace(/^~?\$/, "").match(/(\d+(?:\.\d+)?)/);
  return prem ? `${label} @ ${Number(prem[1]).toFixed(1)}` : label;
}

function asOfAgeSec(asOf) {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 1000);
}

async function fetchJson(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", Cookie: cookie },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function checkPlayPayload(play, desk, tag) {
  if (play.degraded) {
    warn(`${tag}: play degraded — transient upstream blip`);
    return;
  }

  const age = asOfAgeSec(play.as_of);
  if (age != null && age > MAX_AS_OF_AGE_SEC) {
    fail(`${tag}: play.as_of stale (${age}s > ${MAX_AS_OF_AGE_SEC}s)`);
  } else if (age != null) {
    pass(`${tag}: play.as_of fresh (${age}s)`);
  }

  const verdicts = play.playbook_shadow?.verdicts ?? [];
  if (play.playbook_shadow?.mode !== "live") {
    fail(`${tag}: playbook_shadow.mode !== live`);
  } else if (verdicts.length < 14) {
    fail(`${tag}: expected 14 playbook verdicts, got ${verdicts.length}`);
  } else {
    pass(`${tag}: playbook panel — 14 verdicts (mode=live)`);
  }

  const open = play.open_play;
  if (open?.option_label) {
    const occStrike = parseOccStrike(open.option_label);
    const storedStrike = open.option_strike;
    if (occStrike && storedStrike && Math.abs(occStrike - storedStrike) > 1) {
      fail(
        `${tag}: option_label strike ${occStrike} disagrees with option_strike ${storedStrike} (${open.option_label})`
      );
    } else if (occStrike && occStrike >= 60_000) {
      fail(`${tag}: option_label looks like date-as-strike bug (${open.option_label})`);
    } else {
      pass(`${tag}: open play label parses cleanly (${open.option_label})`);
    }

    const chip = compactChipLabel(open.option_label, play.direction, open.option_premium);
    if (chip && /^\d{4,5}[CP] @ \d+\.\d$/.test(chip)) {
      pass(`${tag}: chip label format OK (${chip})`);
    } else if (chip) {
      pass(`${tag}: chip label ${chip}`);
    }

    const mid = play.option_ticket?.mid;
    const prem = open.option_premium;
    if (mid != null && mid > 0 && prem) {
      const premNum = Number(String(prem).replace(/[^\d.]/g, ""));
      if (Number.isFinite(premNum) && Math.abs(mid - premNum) > 2) {
        warn(`${tag}: option_ticket.mid ${mid} vs option_premium ${prem} — wide chain band?`);
      } else {
        pass(`${tag}: live chain premium coherent (mid=${mid}, prem=${prem})`);
      }
    }
  }

  if (desk?.price > 0 && play.levels?.entry > 0) {
    const dist = Math.abs(desk.price - play.levels.entry);
    if (dist > 500) {
      warn(`${tag}: desk.price ${desk.price} far from play entry ${play.levels.entry}`);
    } else {
      pass(`${tag}: desk spot coherent with play entry (Δ${dist.toFixed(1)} pts)`);
    }
  }
}

function checkLottoPower(tag, lotto, power) {
  for (const [name, payload] of [
    ["lotto", lotto?.lotto],
    ["power_hour", power?.power_hour],
  ]) {
    if (!payload) continue;
    if (!payload.contract_label) continue;
    const strike = parseOccStrike(payload.contract_label);
    if (strike && strike >= 60_000) {
      fail(`${tag}: ${name} contract_label date-as-strike (${payload.contract_label})`);
    } else if (strike && payload.strike && Math.abs(strike - payload.strike) > 1) {
      fail(`${tag}: ${name} label strike ${strike} vs stored ${payload.strike}`);
    } else if (strike) {
      pass(`${tag}: ${name} label OK (${payload.contract_label})`);
    }
    if (payload.option_mid > 0 && payload.premium_estimate) {
      pass(`${tag}: ${name} live chain mid=${payload.option_mid} prem=${payload.premium_estimate}`);
    }
  }
}

async function main() {
  console.log(`\n=== Staging desk live validation ===`);
  console.log(`Target: ${BASE}`);
  console.log(`Dual-poll gap: ${POLL_GAP_MS}ms\n`);

  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`SKIP: ${session.reason}`);
    process.exit(0);
  }

  const cookie = session.cookies?.map((c) => `${c.name}=${c.value}`).join("; ") ?? "";

  const snap1 = {
    play: await fetchJson("/api/market/spx/play", cookie),
    desk: await fetchJson("/api/market/spx/desk", cookie),
    lotto: await fetchJson("/api/market/lotto/today", cookie),
    power: await fetchJson("/api/market/spx/power-hour", cookie),
  };

  if (snap1.play.status !== 200) fail(`poll-1: /api/market/spx/play HTTP ${snap1.play.status}`);
  if (snap1.desk.status !== 200) fail(`poll-1: /api/market/spx/desk HTTP ${snap1.desk.status}`);

  checkPlayPayload(snap1.play.body, snap1.desk.body, "poll-1");
  checkLottoPower("poll-1", snap1.lotto.body, snap1.power.body);

  console.log(`\n  … waiting ${POLL_GAP_MS}ms for dynamic refresh …\n`);
  await sleep(POLL_GAP_MS);

  const snap2 = {
    play: await fetchJson("/api/market/spx/play", cookie),
    desk: await fetchJson("/api/market/spx/desk", cookie),
    lotto: await fetchJson("/api/market/lotto/today", cookie),
    power: await fetchJson("/api/market/spx/power-hour", cookie),
  };

  if (snap2.play.status !== 200) fail(`poll-2: /api/market/spx/play HTTP ${snap2.play.status}`);

  checkPlayPayload(snap2.play.body, snap2.desk.body, "poll-2");
  checkLottoPower("poll-2", snap2.lotto.body, snap2.power.body);

  const p1 = snap1.play.body;
  const p2 = snap2.play.body;
  const changed =
    p1.as_of !== p2.as_of ||
    p1.action !== p2.action ||
    p1.score !== p2.score ||
    p1.open_play?.option_premium !== p2.open_play?.option_premium ||
    snap1.desk.body?.price !== snap2.desk.body?.price;

  if (changed) {
    pass(`dual-poll: payload moved (as_of ${p1.as_of} → ${p2.as_of}, action ${p1.action} → ${p2.action})`);
  } else {
    warn("dual-poll: no visible delta — cache window or off-hours flat market");
  }

  if (session.cleanup) await session.cleanup();

  console.log(`\nSummary: ${failures.length} fail, ${warnings.length} warn\n`);
  if (failures.length) {
    process.exit(1);
  }
  console.log("PASS: staging desk live validation");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
