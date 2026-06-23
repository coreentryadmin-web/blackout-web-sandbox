// Pure, alias-free numeric helpers shared across the SPX play/lotto/power-hour
// engines and option-chain builders. Kept dependency-free so `tsx --test` can
// import it via a relative path without alias resolution.
//
// round5 feeds strike sizing on the money path — the implementation here MUST
// remain byte-identical to the copies it replaces:
//   spx-lotto-engine.ts, spx-lotto-options.ts, spx-play-intel.ts,
//   spx-play-options.ts, spx-power-hour-engine.ts

/** Round to the nearest multiple of 5 (SPX strike spacing). */
export function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** Clamp n into the inclusive [min, max] range. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
