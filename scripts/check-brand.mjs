#!/usr/bin/env node
// Brand guard — fails if any grey-family color utility is authored in src/.
// The product surface renders on a near-black void (#040407); grey text/zinc/neutral
// is unreadable there, so the design system is pure brand tokens: bull (#00e676),
// bear (#ff2d55), sky (#7dd3fc), cyan (#22d3ee), gold (#ffd23f), mute (#9fb4d4),
// white, and explicit void surfaces. Run in CI to keep grey from creeping back.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = "src";
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"]);
const FAMILIES = "gray|grey|zinc|neutral|slate|stone";
const PREFIX =
  "text|bg|border|from|via|to|ring|divide|placeholder|outline|decoration|shadow|fill|stroke|accent|caret";
// e.g. text-zinc-400, bg-grey-900/40, border-neutral-700, from-slate-800
const RE = new RegExp(
  `\\b(?:${PREFIX})-(?:${FAMILIES})(?:-(?:50|[1-9]00|950|DEFAULT))?(?:/\\d{1,3})?\\b`,
  "g",
);

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!EXTS.has(extname(p))) continue;
    const lines = readFileSync(p, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(RE);
      if (m) hits.push(`${p}:${i + 1}  ${[...new Set(m)].join(", ")}`);
    });
  }
}
walk(ROOT);

if (hits.length) {
  console.error(
    `✗ Brand guard: ${hits.length} grey-family color class(es) in ${ROOT}/ ` +
      `— use bull/bear/sky/cyan/gold/mute/white or an explicit void surface instead:\n`,
  );
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("✓ Brand guard: no grey-family color classes in src/.");
