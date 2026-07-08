import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";

type SatellitePhase = string;

function isActiveSatellitePhase(phase: SatellitePhase): boolean {
  const p = phase.toUpperCase();
  return p !== "NONE" && p !== "INVALID" && p !== "";
}

function isActiveMainAction(action: string): boolean {
  return action === "BUY" || action === "HOLD" || action === "TRIM" || action === "WATCHING";
}

export function satelliteConflictsMain(
  main: { direction: SpxPlayDirection | null; action: string } | null | undefined,
  satellite: { direction: SpxPlayDirection | null; phase: SatellitePhase } | null | undefined
): boolean {
  if (!main || !satellite) return false;
  if (!isActiveMainAction(main.action)) return false;
  if (!isActiveSatellitePhase(satellite.phase)) return false;
  if (!main.direction || !satellite.direction) return false;
  return main.direction !== satellite.direction;
}

export function satelliteConflictLabel(
  satelliteDir: SpxPlayDirection,
  mainDir: SpxPlayDirection
): string {
  const sat = satelliteDir === "long" ? "CALL" : "PUT";
  const main = mainDir === "long" ? "CALL" : "PUT";
  return `${sat} vs main ${main}`;
}
