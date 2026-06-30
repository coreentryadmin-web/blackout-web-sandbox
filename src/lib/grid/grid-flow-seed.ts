"use client";

import type { FlowAlert } from "@/lib/api";

/** One-shot flow seed from GET /api/grid/bootstrap `market.flows` — consumed on first GridFlowPanel mount. */
let pendingSeed: { flows: FlowAlert[]; count: number } | null = null;

export function setGridFlowSeed(data: { flows: FlowAlert[]; count: number } | null): void {
  pendingSeed = data;
}

/** Returns and clears the bootstrap flow seed (if any). */
export function consumeGridFlowSeed(): { flows: FlowAlert[]; count: number } | null {
  const seed = pendingSeed;
  pendingSeed = null;
  return seed;
}
