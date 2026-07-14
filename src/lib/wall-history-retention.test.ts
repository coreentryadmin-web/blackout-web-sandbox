import { test } from "node:test";
import assert from "node:assert/strict";
import {
  wallHistoryRetentionDays,
  buildWallHistoryDeleteQuery,
  WALL_HISTORY_RETENTION_DEFAULT_DAYS,
  WALL_HISTORY_RETENTION_MIN_DAYS,
  WALL_HISTORY_RETENTION_MAX_DAYS,
  WALL_HISTORY_DELETE_BATCH,
  WALL_HISTORY_TABLE,
  WALL_HISTORY_AGE_COLUMN,
} from "./wall-history-retention";

// --- env default / override / clamp -----------------------------------------

test("defaults to the staging 30d window when the env var is unset/empty", () => {
  assert.equal(wallHistoryRetentionDays(undefined), 30);
  assert.equal(wallHistoryRetentionDays(""), 30);
  assert.equal(wallHistoryRetentionDays("   "), 30);
  assert.equal(WALL_HISTORY_RETENTION_DEFAULT_DAYS, 30);
});

test("reads the process env default binding when called with no argument", () => {
  const prev = process.env.WALL_HISTORY_RETENTION_DAYS;
  try {
    delete process.env.WALL_HISTORY_RETENTION_DAYS;
    assert.equal(wallHistoryRetentionDays(), 30);
    process.env.WALL_HISTORY_RETENTION_DAYS = "90"; // prod
    assert.equal(wallHistoryRetentionDays(), 90);
  } finally {
    if (prev === undefined) delete process.env.WALL_HISTORY_RETENTION_DAYS;
    else process.env.WALL_HISTORY_RETENTION_DAYS = prev;
  }
});

test("honors a valid override (prod 90d)", () => {
  assert.equal(wallHistoryRetentionDays("90"), 90);
  assert.equal(wallHistoryRetentionDays("45"), 45);
  assert.equal(wallHistoryRetentionDays("30.4"), 30); // rounds to whole days
});

test("clamps below the floor so a typo can never wipe recent replay history", () => {
  assert.equal(wallHistoryRetentionDays("0"), WALL_HISTORY_RETENTION_MIN_DAYS);
  assert.equal(wallHistoryRetentionDays("-5"), WALL_HISTORY_RETENTION_MIN_DAYS);
  assert.equal(wallHistoryRetentionDays("3"), WALL_HISTORY_RETENTION_MIN_DAYS);
});

test("clamps above the ceiling", () => {
  assert.equal(wallHistoryRetentionDays("999999"), WALL_HISTORY_RETENTION_MAX_DAYS);
});

test("falls back to default on non-numeric garbage", () => {
  assert.equal(wallHistoryRetentionDays("abc"), 30);
  assert.equal(wallHistoryRetentionDays("NaN"), 30);
});

// --- query bound ------------------------------------------------------------

test("delete query bounds the window as a parameter and batches by ctid", () => {
  const { text, values } = buildWallHistoryDeleteQuery(30);
  // window + batch cap are parameterized ($1/$2), never string-interpolated
  assert.match(text, /\$1::int \|\| ' days'\)::interval/);
  assert.match(text, /LIMIT \$2/);
  assert.match(text, new RegExp(`DELETE FROM ${WALL_HISTORY_TABLE}`));
  assert.match(text, new RegExp(`WHERE ${WALL_HISTORY_AGE_COLUMN} <`));
  assert.deepEqual(values, [30, WALL_HISTORY_DELETE_BATCH]);
});

test("delete query passes the resolved window through as the age bound", () => {
  assert.deepEqual(buildWallHistoryDeleteQuery(90).values, [90, WALL_HISTORY_DELETE_BATCH]);
});

test("delete query refuses an unsafe (sub-floor / non-integer) window", () => {
  // Guards against a caller passing a raw/unclamped value straight into the DELETE.
  assert.throws(() => buildWallHistoryDeleteQuery(0));
  assert.throws(() => buildWallHistoryDeleteQuery(3));
  assert.throws(() => buildWallHistoryDeleteQuery(30.5));
});
