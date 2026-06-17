const IDLE_LINES = [
  "Scanning for a monster move on SPX…",
  "Dealers loading — waiting for the trap door…",
  "No edge yet — patience is the trade.",
  "Flow's quiet. The next rip starts at a level.",
  "0DTE coiling — A+ setups only.",
  "Hunting gamma — structure before size.",
  "Tape whispering. A+ or nothing.",
  "Levels loading. Monster moves need confluence.",
];

let lastRotateAt = 0;
let lastIndex = 0;

export function pickIdleMessage(now = Date.now()): string {
  const rotateMs = 45_000;
  if (now - lastRotateAt >= rotateMs) {
    lastIndex = (lastIndex + 1) % IDLE_LINES.length;
    lastRotateAt = now;
  }
  return IDLE_LINES[lastIndex] ?? IDLE_LINES[0];
}

export function watchMessage(grade: string, direction: string): string {
  return `${grade} ${direction} setup forming — on watch for confirmation.`;
}
