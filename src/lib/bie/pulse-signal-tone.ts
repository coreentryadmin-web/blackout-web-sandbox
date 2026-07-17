/** Professional labels for Vector Pulse signal lines (emoji stripped before member sees them). */

const PREFIX_MAP: Array<[RegExp, string]> = [
  [/^⚡\s*regime flipped\s*→\s*/i, "**Regime flip** — "],
  [/^🎯\s*/i, "**Proximity** — "],
  [/^🔥\s*/i, "**Level test** — "],
  [/^↔\s*/i, "**Proximity cleared** — "],
  [/^🧲\s*/i, "**Magnet shift** — "],
  [/^⚠️\s*/i, "**Wall integrity** — "],
  [/^✅\s*/i, "**Wall integrity** — "],
  [/^🎯\s*PLAY OPENED/i, "**Play opened** —"],
  [/^⏹\s*/i, "**Play closed** — "],
  [/^👁\s*/i, "**Watching setup** — "],
  [/^💰\s*/i, "**Flow print** — "],
];

/** Convert Pulse UI emoji lines to institutional markdown (before global emoji strip). */
export function professionalizePulseLine(line: string): string {
  let out = line.trim();
  for (const [re, rep] of PREFIX_MAP) {
    if (re.test(out)) {
      out = out.replace(re, rep);
      break;
    }
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function professionalizePulseSignals(signals: { line: string }[]): void {
  for (const sig of signals) {
    sig.line = professionalizePulseLine(sig.line);
  }
}
