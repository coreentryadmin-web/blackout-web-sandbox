import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlayOutcomeStats, type PlayOutcomeRow } from "./spx-play-outcomes";

function row(partial: Partial<PlayOutcomeRow> & Pick<PlayOutcomeRow, "entry_path" | "outcome">): PlayOutcomeRow {
  return {
    id: 1,
    open_play_id: 1,
    session_date: "2026-06-01",
    direction: "long",
    grade: "A",
    score: 80,
    confidence: 0.8,
    entry_price: 6000,
    exit_price: 6010,
    stop: 5990,
    target: 6020,
    mfe_pts: 12,
    mae_pts: 4,
    trim_done: false,
    pnl_pts: 10,
    exit_action: "TARGET",
    headline: "test",
    opened_at: "2026-06-01T14:00:00.000Z",
    closed_at: "2026-06-01T15:00:00.000Z",
    ...partial,
  };
}

test("computePlayOutcomeStats overall win rate and path buckets", () => {
  const stats = computePlayOutcomeStats([
    row({ entry_path: "cold_buy", outcome: "win", mfe_pts: 10, mae_pts: 2 }),
    row({ entry_path: "cold_buy", outcome: "loss", mfe_pts: 4, mae_pts: 8 }),
    row({ entry_path: "watch_promote", outcome: "win", mfe_pts: 6, mae_pts: 1 }),
    row({ entry_path: "watch_promote", outcome: "open" }),
  ]);

  assert.equal(stats.total_closed, 3);
  assert.equal(stats.overall.wins, 2);
  assert.equal(stats.overall.losses, 1);
  assert.equal(stats.overall.win_rate, 2 / 3);
  assert.equal(stats.cold_buy.count, 2);
  assert.equal(stats.cold_buy.win_rate, 0.5);
  assert.equal(stats.cold_buy.avg_mfe, 7);
  assert.equal(stats.watch_promote.count, 1);
  assert.equal(stats.watch_promote.win_rate, 1);
});

test("computePlayOutcomeStats excludes superseded rows from win rate", () => {
  const stats = computePlayOutcomeStats([
    row({ entry_path: "cold_buy", outcome: "win" }),
    row({ entry_path: "cold_buy", outcome: "superseded" }),
    row({ entry_path: "cold_buy", outcome: "loss" }),
  ]);
  assert.equal(stats.total_closed, 2);
  assert.equal(stats.overall.wins, 1);
  assert.equal(stats.overall.losses, 1);
  assert.equal(stats.overall.win_rate, 0.5);
});
