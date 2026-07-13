import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNewsArticles,
  buildNewsResult,
  fetchTickerNews,
  fetchMarketCatalysts,
  type NewsItem,
} from "./polygon-news";

// Fixture mirrors the live /benzinga/v2/news payload shape (scratchpad/polygon-arsenal.log):
// results[].{ benzinga_id|id, title, published, url, channels, tickers }
const FIXTURE = {
  results: [
    {
      id: "101",
      title: "FDA approves NVDA-partnered therapy",
      published: "2026-07-13T14:00:00Z",
      channels: ["fda"],
      tickers: ["nvda", "xyz"],
      url: "https://benzinga.com/a/101",
    },
    {
      benzinga_id: "102",
      title: "MegaCorp raises full-year guidance",
      created_at: "2026-07-13T15:30:00Z", // newer, via alt date field
      channels: ["guidance"],
      tickers: ["MEGA"],
      benzinga_url: "https://benzinga.com/a/102",
    },
    { id: "103", title: "", channels: ["m&a"], tickers: ["ZZZ"] }, // no headline → dropped
  ],
};

test("normalizeNewsArticles: maps fields, uppercases tickers, drops headline-less entries", () => {
  const items = normalizeNewsArticles(FIXTURE);
  assert.equal(items.length, 2); // the empty-title row is dropped
  const [a, b] = items;
  assert.equal(a.id, "101");
  assert.equal(a.headline, "FDA approves NVDA-partnered therapy");
  assert.equal(a.source, "benzinga");
  assert.equal(a.publishedAt, "2026-07-13T14:00:00Z");
  assert.deepEqual(a.channels, ["fda"]);
  assert.deepEqual(a.tickers, ["NVDA", "XYZ"]); // uppercased
  assert.equal(a.url, "https://benzinga.com/a/101");
  // Alt field names resolve.
  assert.equal(b.id, "102");
  assert.equal(b.publishedAt, "2026-07-13T15:30:00Z");
  assert.equal(b.url, "https://benzinga.com/a/102");
});

test("normalizeNewsArticles: tolerates junk (non-array results, non-objects, missing fields)", () => {
  assert.deepEqual(normalizeNewsArticles(null), []);
  assert.deepEqual(normalizeNewsArticles({}), []);
  assert.deepEqual(normalizeNewsArticles({ results: "nope" }), []);
  assert.deepEqual(normalizeNewsArticles({ results: [null, 5, "x"] }), []);
  // Bare array form (results not wrapped) also works.
  const items = normalizeNewsArticles([{ id: "1", title: "Hi", tickers: null, channels: undefined }]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].tickers, []);
  assert.deepEqual(items[0].channels, []);
});

test("buildNewsResult: computes newest from the freshest publishedAt + asOf present", () => {
  const items: NewsItem[] = [
    { id: "1", headline: "a", source: "benzinga", publishedAt: "2026-07-13T14:00:00Z", channels: [], tickers: [], url: "" },
    { id: "2", headline: "b", source: "benzinga", publishedAt: "2026-07-13T15:30:00Z", channels: [], tickers: [], url: "" },
  ];
  const r = buildNewsResult(items);
  assert.equal(r.newest, "2026-07-13T15:30:00Z");
  assert.equal(typeof r.asOf, "string");
  assert.equal(r.unavailable, undefined); // success → no unavailable
});

test("buildNewsResult: empty items → newest null, no unavailable unless set", () => {
  const clean = buildNewsResult([]);
  assert.deepEqual(clean.items, []);
  assert.equal(clean.newest, null);
  assert.equal(clean.unavailable, undefined);

  const failed = buildNewsResult([], "ticker news NVDA unavailable: 500");
  assert.equal(failed.unavailable, "ticker news NVDA unavailable: 500");
});

// Fail-open integration: with POLYGON_API_KEY unset, both readers return the fail-open shape and
// NEVER throw (the strict-lane requirement). Run in a child env with the key cleared.
test("fetchTickerNews / fetchMarketCatalysts: unconfigured → fail-open, never throws", async () => {
  const saved = process.env.POLYGON_API_KEY;
  delete process.env.POLYGON_API_KEY;
  try {
    const t = await fetchTickerNews("NVDA");
    assert.deepEqual(t.items, []);
    assert.match(t.unavailable ?? "", /POLYGON_API_KEY not set/);
    const c = await fetchMarketCatalysts({ channels: "fda" });
    assert.deepEqual(c.items, []);
    assert.match(c.unavailable ?? "", /POLYGON_API_KEY not set/);
  } finally {
    if (saved !== undefined) process.env.POLYGON_API_KEY = saved;
  }
});
