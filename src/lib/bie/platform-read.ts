import "server-only";

import { getBieFullStateForLargo } from "@/lib/bie/full-platform-loader";
import { formatBieFullStateAnswer } from "@/lib/bie/platform-read-format";
import type { BieComposed } from "@/lib/bie/composers-shared";

/** Cross-product platform read — every major surface in one deterministic answer. */
export async function composePlatformRead(): Promise<BieComposed> {
  const state = await getBieFullStateForLargo();
  return {
    answer: formatBieFullStateAnswer(state),
    context: state,
  };
}
