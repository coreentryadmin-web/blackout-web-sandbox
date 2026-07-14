import test from "node:test";
import assert from "node:assert/strict";
import { scrollRowIntoViewCenter } from "./spx-matrix-scroll";

test("scrollRowIntoViewCenter: adjusts scrollTop toward vertical center", () => {
  const scrollEl = {
    scrollTop: 0,
    scrollHeight: 800,
    clientHeight: 200,
    getBoundingClientRect: () => ({ top: 100, height: 200 }),
  } as unknown as HTMLElement;

  const rowEl = {
    getBoundingClientRect: () => ({ top: 300, height: 20 }),
  } as unknown as HTMLElement;

  scrollRowIntoViewCenter(scrollEl, rowEl);
  // row center (310) vs viewport center (200) => delta 110
  assert.equal(scrollEl.scrollTop, 110);
});
