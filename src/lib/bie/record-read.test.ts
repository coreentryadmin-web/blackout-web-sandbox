import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRecordAnswer } from "@/lib/bie/record-read";
import { emptyTrackRecord } from "@/lib/track-record-public";

describe("record-read", () => {
  it("formats empty record honestly", () => {
    const text = formatRecordAnswer(emptyTrackRecord());
    assert.match(text, /No closed plays/i);
  });

  it("formats aggregate stats", () => {
    const text = formatRecordAnswer({
      ...emptyTrackRecord(),
      available: true,
      total_closed: 42,
      days_of_data: 10,
      win_rate_pct: 62,
      wins: 26,
      losses: 14,
      breakeven: 2,
      paths: {
        cold_buy: { count: 30, win_rate_pct: 60, avg_mfe_pts: 4.2 },
        watch_promote: { count: 12, win_rate_pct: 67, avg_mfe_pts: 5.1 },
      },
      adaptive_active: true,
      summary: "Gates tightened after cold streak.",
    });
    assert.match(text, /42/);
    assert.match(text, /62%/);
    assert.match(text, /Cold buy/);
  });
});
