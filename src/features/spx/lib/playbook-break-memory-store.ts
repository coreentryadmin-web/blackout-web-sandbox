import { getMeta, setMeta } from "@/lib/db";
import {
  emptyOrBreakMemory,
  updateOrBreakMemory,
  type OrBreakMemory,
} from "@/features/spx/lib/playbook-break-memory";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

const META_PREFIX = "spx_playbook_or_break:";

function metaKey(sessionDate: string): string {
  return `${META_PREFIX}${sessionDate}`;
}

export async function loadOrBreakMemory(sessionDate: string): Promise<OrBreakMemory> {
  const raw = await getMeta(metaKey(sessionDate));
  if (!raw) return emptyOrBreakMemory(sessionDate);
  try {
    const parsed = JSON.parse(raw) as OrBreakMemory;
    if (parsed.session_date !== sessionDate) return emptyOrBreakMemory(sessionDate);
    return parsed;
  } catch {
    return emptyOrBreakMemory(sessionDate);
  }
}

export async function refreshOrBreakMemory(
  sessionDate: string,
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null | undefined,
  persist = false
): Promise<OrBreakMemory> {
  if (!technicals?.available || !technicals.or_defined) {
    return loadOrBreakMemory(sessionDate);
  }

  const prev = await loadOrBreakMemory(sessionDate);
  const next = updateOrBreakMemory(prev, desk, technicals);
  const changed = JSON.stringify(prev) !== JSON.stringify(next);
  if (persist && changed) {
    await setMeta(metaKey(sessionDate), JSON.stringify(next));
  }
  return next;
}
