import { largoSkipBieRouter } from "@/lib/ai-env";
import { prefetchLargoLiveFeed } from "@/lib/bie/largo-live-prefetch";
import { createLargoStatusTicker, pickLargoStatusLine } from "@/lib/bie/largo-status";
import { tryBieRoute, type BieRoutedAnswer } from "@/lib/largo/bie-route";

export type LargoTurnPipelineOpts = {
  question: string;
  userId?: string;
  onStatus?: (message: string) => void;
};

/** Warm platform caches, optionally classify via BIE router (skipped when Claude-only Largo). */
export async function resolveLargoBieRoute(opts: LargoTurnPipelineOpts): Promise<BieRoutedAnswer | null> {
  const { question, userId, onStatus } = opts;

  if (largoSkipBieRouter()) {
    onStatus?.(pickLargoStatusLine({ phase: "boot", index: 0 }));
    await prefetchLargoLiveFeed({ onStatus });
    onStatus?.(pickLargoStatusLine({ phase: "boot", index: 1 }));
    return null;
  }

  const routeTicker = createLargoStatusTicker({
    phase: "route",
    onStatus: onStatus ?? (() => {}),
    intervalMs: 1_100,
  });
  routeTicker.start();
  try {
    await prefetchLargoLiveFeed({ onStatus });
    return await tryBieRoute(question, { onStatus, userId });
  } finally {
    routeTicker.stop();
  }
}
