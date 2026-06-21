import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

/** Per-user cache keyed by userId — prevents one user's request from overwriting another's. */
const bundleByUser = new Map<string, Awaited<ReturnType<typeof loadMergedSpxDesk>>>();

export function resetLargoSpxDeskCache(userId: string): void {
  bundleByUser.delete(userId);
}

/** One merged desk load per Largo query per user — pulse + flow + full desk, same as SPX Sniper. */
export async function getLargoSpxLiveDesk(userId: string): Promise<SpxDeskPayload> {
  let bundle = bundleByUser.get(userId) ?? null;
  if (!bundle) {
    bundle = await loadMergedSpxDesk();
    bundleByUser.set(userId, bundle);
  }
  return bundle.merged;
}
