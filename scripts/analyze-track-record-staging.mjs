#!/usr/bin/env node
/**
 * Staging track-record counterfactual analysis via HTTP (no direct RDS).
 * Uses AWS Secrets Manager + Cognito admin session from mintAppSession.
 *
 * Usage: node --import tsx scripts/analyze-track-record-staging.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mintAppSession } from "./audit/lib/app-session.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

function targetPtsNeeded(row) {
  const entry = Number(row.entry_price);
  const target = row.target != null ? Number(row.target) : null;
  if (target == null || !Number.isFinite(entry) || !Number.isFinite(target)) return null;
  const dir = String(row.direction ?? "").toLowerCase();
  if (dir === "short") return entry - target;
  return target - entry;
}

function couldHaveHitTarget(row) {
  const need = targetPtsNeeded(row);
  if (need == null || need <= 0) return null;
  const mfe = Number(row.mfe_pts ?? 0);
  return mfe >= need;
}

async function fetchJson(path, headers) {
  const res = await fetchRetry(`${BASE}${path}`, { headers, cache: "no-store" }, { retries: 3, timeoutMs: 120_000 });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const { classifyOutcome, playCloseWasLoss, computePlayOutcomeStats } = await import(
    "../src/features/spx/lib/spx-play-outcomes.ts"
  );

  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("FATAL: cannot mint staging session:", session.reason);
    process.exit(2);
  }

  const headers = { Accept: "application/json", Cookie: session.cookieHeader };

  const [outcomesRes, promoRes, publicRes] = await Promise.all([
    fetchJson("/api/market/spx/outcomes?limit=200", headers),
    fetchJson("/api/admin/playbook/promotion-report", headers),
    fetchJson("/api/public/track-record", headers),
  ]);

  if (outcomesRes.status !== 200) {
    console.error("FATAL: outcomes HTTP", outcomesRes.status, outcomesRes.body);
    process.exit(2);
  }

  const rows = (outcomesRes.body?.rows ?? []).filter((r) => r.outcome && r.outcome !== "open");
  const storedStats = outcomesRes.body?.stats ?? null;

  const regraded = rows.map((r) => {
    const pnl = r.pnl_pts != null ? Number(r.pnl_pts) : 0;
    const exitAction = String(r.exit_action ?? "UNKNOWN").toUpperCase();
    const wasLoss = playCloseWasLoss(pnl);
    const correct = classifyOutcome({
      exit_price: Number(r.exit_price ?? 0),
      exit_action: exitAction,
      mfe_pts: Number(r.mfe_pts ?? 0),
      mae_pts: Number(r.mae_pts ?? 0),
      trim_done: Boolean(r.trim_done),
      was_loss: wasLoss,
      pnl_pts: pnl,
    });
    const tgtHit = couldHaveHitTarget(r);
    return {
      id: r.id,
      open_play_id: r.open_play_id,
      session_date: r.session_date,
      direction: r.direction,
      grade: r.grade,
      entry_path: r.entry_path,
      pnl_pts: pnl,
      mfe_pts: Number(r.mfe_pts ?? 0),
      mae_pts: Number(r.mae_pts ?? 0),
      target_pts_needed: targetPtsNeeded(r),
      stored_outcome: r.outcome,
      regraded_outcome: correct,
      mismatch: correct !== r.outcome,
      exit_action: exitAction,
      could_hit_target: tgtHit,
      headline: r.headline,
      closed_at: r.closed_at,
    };
  });

  const afterStats = computePlayOutcomeStats(
    rows.map((r) => ({
      ...r,
      id: Number(r.id),
      open_play_id: Number(r.open_play_id),
      score: Number(r.score),
      confidence: Number(r.confidence),
      entry_price: Number(r.entry_price),
      exit_price: r.exit_price != null ? Number(r.exit_price) : null,
      stop: r.stop != null ? Number(r.stop) : null,
      target: r.target != null ? Number(r.target) : null,
      mfe_pts: Number(r.mfe_pts ?? 0),
      mae_pts: Number(r.mae_pts ?? 0),
      trim_done: Boolean(r.trim_done),
      pnl_pts: r.pnl_pts != null ? Number(r.pnl_pts) : null,
    }))
  );

  const regradedStats = { win: 0, loss: 0, breakeven: 0 };
  for (const r of regraded) {
    regradedStats[r.regraded_outcome] = (regradedStats[r.regraded_outcome] ?? 0) + 1;
  }

  const mismatches = regraded.filter((r) => r.mismatch);
  const storedLosses = regraded.filter((r) => r.stored_outcome === "loss");
  const regradedLosses = regraded.filter((r) => r.regraded_outcome === "loss");
  const mfeCouldWin = regradedLosses.filter((r) => r.could_hit_target === true);
  const positivePnlLosses = regradedLosses.filter((r) => r.pnl_pts > 0);

  const hypotheticalAllWin = regraded.every(
    (r) => r.regraded_outcome === "win" || r.could_hit_target === true
  );

  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    total_closed: rows.length,
    stored_api_stats: storedStats,
    stored_row_stats: afterStats.overall,
    regraded_stats: regradedStats,
    grade_mismatches: mismatches.length,
    mismatches,
    stored_losses: storedLosses.length,
    regraded_losses: regradedLosses.length,
    losses_with_positive_pnl: positivePnlLosses.length,
    losses_mfe_reached_target: mfeCouldWin.length,
    could_all_be_winners_under_current_logic: hypotheticalAllWin,
    caveat:
      "MFE-vs-target is a ceiling check only — not minute-bar replay or alternate exit timing.",
    promotion_report_status: promoRes.status,
    promotion_report: promoRes.status === 200 ? promoRes.body : null,
    public_track_record_status: publicRes.status,
    public_track_record: publicRes.status === 200 ? publicRes.body : null,
    plays: regraded,
  };

  const outPath = join(OUT, "track-record-counterfactual.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== SPX track-record counterfactual (staging HTTP) ===\n");
  console.log(`Closed plays (limit 200): ${rows.length}`);
  console.log(
    `Stored ledger: ${afterStats.overall.wins}W / ${afterStats.overall.losses}L / ${afterStats.overall.breakeven}BE`
  );
  console.log(
    `Regraded (classifyOutcome+playCloseWasLoss): ${regradedStats.win ?? 0}W / ${regradedStats.loss ?? 0}L / ${regradedStats.breakeven ?? 0}BE`
  );
  console.log(`Grade mismatches vs DB: ${mismatches.length}`);
  console.log(`Losses where MFE reached target: ${mfeCouldWin.length} / ${regradedLosses.length}`);
  console.log(`Losses with positive pnl_pts: ${positivePnlLosses.length}`);
  console.log(`Could ALL be winners? ${hypotheticalAllWin ? "YES (ceiling)" : "NO"}`);

  if (mismatches.length) {
    console.log("\n--- Grade mismatches ---");
    for (const m of mismatches) {
      console.log(
        `  id=${m.id} ${m.session_date} ${m.exit_action} pnl=${m.pnl_pts} stored=${m.stored_outcome} → ${m.regraded_outcome}`
      );
    }
  }

  if (regradedLosses.length) {
    console.log("\n--- Regraded losses ---");
    for (const l of regradedLosses) {
      const tgt = l.target_pts_needed != null ? ` need=${l.target_pts_needed.toFixed(2)} mfe=${l.mfe_pts.toFixed(2)}` : "";
      const ceiling = l.could_hit_target === true ? " [MFE≥target]" : l.could_hit_target === false ? " [MFE<target]" : "";
      console.log(
        `  id=${l.id} ${l.session_date} ${l.direction} ${l.exit_action} pnl=${l.pnl_pts}${tgt}${ceiling} — ${l.headline?.slice(0, 60) ?? ""}`
      );
    }
  }

  if (promoRes.status === 200 && promoRes.body?.playbooks) {
    console.log("\n--- Promotion report (OOS sample) ---");
    for (const pb of promoRes.body.playbooks.slice(0, 8)) {
      console.log(
        `  ${pb.playbook_id ?? pb.id}: n=${pb.sample_size ?? pb.n ?? "?"} net=${pb.net_expectancy_pts ?? pb.net_pts ?? "?"}`
      );
    }
  }

  console.log(`\nFull JSON: ${outPath}\n`);

  if (session.cleanup) await session.cleanup();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
