#!/usr/bin/env node
/**
 * Guard against the repo's most-recurring build breaker (4 occurrences as of
 * 2026-07-11: f7d56fb, #117, #120, #132): a Tailwind color-opacity modifier
 * inside an @apply rule that is not on the default opacity scale (multiples
 * of 5). In markup an invalid modifier silently generates nothing; inside
 * @apply it is a hard PostCSS error, so `next build` fails repo-wide — and
 * because cursor/* branches auto-merge before their own CI completes, the
 * break lands directly on the deploy branch every time.
 *
 * Valid:   border-white/10, bg-black/25, text-sky-300/35, bg-bull/[0.12]
 * Invalid: border-white/8, bg-bull/12, text-sky-300/72
 *
 * Fraction utilities (left-1/2, translate-x-1/2, w-1/3, …) are positional,
 * not opacity — excluded.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FRACTION_UTILITIES =
  /^(-?(left|right|top|bottom|inset|translate-x|translate-y|w|h|basis|grid-cols|grid-rows)-)/;

function* cssFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* cssFiles(p);
    else if (name.endsWith(".css")) yield p;
  }
}

const violations = [];
for (const file of cssFiles(join(ROOT, "src"))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.includes("@apply")) return;
    for (const m of line.matchAll(/[a-z][a-z0-9-]*\/(\d+)/g)) {
      const token = m[0];
      const n = Number(m[1]);
      if (n % 5 === 0) continue;
      if (FRACTION_UTILITIES.test(token)) continue;
      violations.push(`${file.replace(ROOT, "")}:${i + 1} — \`${token}\` (opacity must be a multiple of 5, or use /[0.${String(m[1]).padStart(2, "0")}])`);
    }
  });
}

if (violations.length) {
  console.error("Invalid Tailwind opacity modifiers inside @apply (breaks `next build`):\n");
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nUse a scale value (/5, /10, …) or an arbitrary value (/[0.08]) — see docs/audit/FINDINGS.md 2026-07-11."
  );
  process.exit(1);
}
console.log("tailwind @apply opacity check: clean");
