/**
 * BlackOut Market Platform — shared data plane for SPX Slayer, Night Hawk, Largo AI, and HELIX.
 * Any product module can import `marketPlatform` to read another service's live or persisted state.
 */
import type { PlatformServiceId, PlatformSnapshot } from "./types";
import * as spx from "./spx-service";
import * as flows from "./flow-service";
import * as nighthawk from "./nighthawk-service";
import * as zerodte from "./zerodte-service";

export type { PlatformServiceId, PlatformSnapshot, SpxDeskSummary, FlowTapeSummary, NightHawkEditionSummary } from "./types";
export type { ZeroDteBoardPayload } from "./zerodte-service";

export const marketPlatform = {
  spx,
  flows,
  nighthawk,
  zerodte,

  /** Invoke any Largo tool by name — lazy import avoids circular deps with run-tool. */
  async invokeLargoTool(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
    const { runLargoTool } = await import("@/lib/largo/run-tool");
    return runLargoTool(name, input);
  },
} as const;

/** Cross-service snapshot — parallel fetch of live desk, flow tape, and latest Night Hawk edition. */
export async function getPlatformSnapshot(opts?: {
  include?: PlatformServiceId[];
  flowLimit?: number;
  fullEdition?: boolean;
}): Promise<PlatformSnapshot> {
  const include = new Set<PlatformServiceId>(opts?.include ?? ["spx", "flows", "nighthawk"]);
  const as_of = new Date().toISOString();
  const snapshot: PlatformSnapshot = { as_of };

  const jobs: Promise<void>[] = [];

  if (include.has("spx")) {
    jobs.push(
      spx.getSpxDeskSummary().then((v) => {
        snapshot.spx = v;
      }).catch(() => {
        snapshot.spx = null;
      })
    );
  }

  if (include.has("flows")) {
    jobs.push(
      flows.getFlowTapeSummary({ limit: opts?.flowLimit ?? 50 }).then((v) => {
        snapshot.flows = v;
      }).catch(() => {
        snapshot.flows = null;
      })
    );
  }

  if (include.has("nighthawk")) {
    jobs.push(
      (async () => {
        if (opts?.fullEdition) {
          snapshot.nighthawk_edition = await nighthawk.getLatestNightHawkEdition();
          snapshot.nighthawk = nighthawk.summarizeNightHawkEdition(snapshot.nighthawk_edition);
        } else {
          snapshot.nighthawk = await nighthawk.getLatestNightHawkSummary();
        }
      })().catch(() => {
        snapshot.nighthawk = null;
      })
    );
  }

  await Promise.all(jobs);
  return snapshot;
}
