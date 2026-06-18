import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

let bundle: Awaited<ReturnType<typeof loadMergedSpxDesk>> | null = null;

export function resetLargoSpxDeskCache(): void {
  bundle = null;
}

/** One merged desk load per Largo query — pulse + flow + full desk, same as SPX Sniper. */
export async function getLargoSpxLiveDesk(): Promise<SpxDeskPayload> {
  if (!bundle) bundle = await loadMergedSpxDesk();
  return bundle.merged;
}
