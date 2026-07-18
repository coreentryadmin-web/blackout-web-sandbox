#!/usr/bin/env node
/**
 * One-time backfill: re-grade closed spx_play_outcomes rows using classifyOutcome().
 *
 * Fixes rows where THESIS (and similar) exits were stored as `loss` despite positive pnl_pts
 * (#194 — code fix only applied to new closes; this repairs historical rows).
 *
 * Usage:
 *   node --import tsx scripts/backfill-thesis-outcomes.mjs           # dry-run (default)
 *   node --import tsx scripts/backfill-thesis-outcomes.mjs --apply   # write updates
 *
 * Requires DATABASE_URL or DATABASE_PUBLIC_URL env var.
 */
import { createAuditClient, resolveAuditDbUrl } from "./pg-audit.mjs";

const apply = process.argv.includes("--apply");

async function resolveDbUrl() {
  const url = resolveAuditDbUrl();
  if (!url) {
    console.error("FATAL: no DATABASE_URL — set env var.");
    process.exit(2);
  }
  return url;
}

function inferWasLoss(row) {
  if (row.pnl_pts != null && row.pnl_pts < 0) return true;
  if (row.outcome === "loss") return true;
  return false;
}

async function main() {
  const { classifyOutcome, computePlayOutcomeStats } = await import(
    "../src/features/spx/lib/spx-play-outcomes.ts"
  );

  const dbUrl = await resolveDbUrl();
  // Shared audit SSL posture (pg-audit.mjs) — never inline rejectUnauthorized.
  const client = createAuditClient(dbUrl);
  await client.connect();

  const { rows } = await client.query(`
    SELECT id, open_play_id, session_date, direction, entry_path, grade, score, confidence,
           entry_price, exit_price, stop, target, mfe_pts, mae_pts, trim_done, pnl_pts,
           outcome, exit_action, headline, opened_at, closed_at
    FROM spx_play_outcomes
    WHERE outcome <> 'open'
    ORDER BY closed_at DESC NULLS LAST
  `);

  const beforeStats = computePlayOutcomeStats(
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
      session_date: String(r.session_date).slice(0, 10),
      opened_at: r.opened_at instanceof Date ? r.opened_at.toISOString() : String(r.opened_at),
      closed_at: r.closed_at instanceof Date ? r.closed_at.toISOString() : r.closed_at,
    }))
  );

  const changes = [];
  for (const r of rows) {
    const pnl = r.pnl_pts != null ? Number(r.pnl_pts) : 0;
    const exitAction = (r.exit_action ?? "UNKNOWN").toUpperCase();
    const correct = classifyOutcome({
      exit_price: Number(r.exit_price ?? 0),
      exit_action: exitAction,
      mfe_pts: Number(r.mfe_pts ?? 0),
      mae_pts: Number(r.mae_pts ?? 0),
      trim_done: Boolean(r.trim_done),
      was_loss: inferWasLoss(r),
      pnl_pts: pnl,
    });
    if (correct !== r.outcome) {
      changes.push({
        id: Number(r.id),
        open_play_id: Number(r.open_play_id),
        session_date: String(r.session_date).slice(0, 10),
        exit_action: exitAction,
        pnl_pts: pnl,
        from: r.outcome,
        to: correct,
      });
    }
  }

  console.log("\n=== SPX play outcome backfill (#194 historical rows) ===\n");
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Closed rows scanned: ${rows.length}`);
  console.log(
    `Before: ${beforeStats.overall.wins}W / ${beforeStats.overall.losses}L / ${beforeStats.overall.breakeven}BE → win rate ${beforeStats.total_closed ? Math.round(beforeStats.overall.win_rate * 1000) / 10 : 0}%`
  );

  if (changes.length === 0) {
    console.log("\nNo rows need updating — ledger already matches classifyOutcome().");
    await client.end();
    return;
  }

  console.log(`\nRows to update: ${changes.length}`);
  for (const c of changes) {
    console.log(
      `  id=${c.id} open_play=${c.open_play_id} ${c.session_date} ${c.exit_action} pnl=${c.pnl_pts} → ${c.from} → ${c.to}`
    );
  }

  if (!apply) {
    console.log("\nRe-run with --apply to write changes.");
    await client.end();
    return;
  }

  await client.query("BEGIN");
  try {
    for (const c of changes) {
      await client.query(`UPDATE spx_play_outcomes SET outcome = $2 WHERE id = $1`, [
        c.id,
        c.to,
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }

  const { rows: afterRows } = await client.query(`
    SELECT id, open_play_id, session_date, direction, entry_path, grade, score, confidence,
           entry_price, exit_price, stop, target, mfe_pts, mae_pts, trim_done, pnl_pts,
           outcome, exit_action, headline, opened_at, closed_at
    FROM spx_play_outcomes
    WHERE outcome <> 'open'
    ORDER BY closed_at DESC NULLS LAST
  `);

  const afterStats = computePlayOutcomeStats(
    afterRows.map((r) => ({
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
      session_date: String(r.session_date).slice(0, 10),
      opened_at: r.opened_at instanceof Date ? r.opened_at.toISOString() : String(r.opened_at),
      closed_at: r.closed_at instanceof Date ? r.closed_at.toISOString() : r.closed_at,
    }))
  );

  console.log(
    `\nAfter: ${afterStats.overall.wins}W / ${afterStats.overall.losses}L / ${afterStats.overall.breakeven}BE → win rate ${afterStats.total_closed ? Math.round(afterStats.overall.win_rate * 1000) / 10 : 0}%`
  );
  console.log("\nBackfill applied successfully.\n");

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
