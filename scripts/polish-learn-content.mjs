#!/usr/bin/env node
/**
 * Repair UTF-8 mojibake + migrate learn pages off banned slate utilities.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src", "app", "(site)", "learn");

const REPLACEMENTS = [
  ["Ã—", "×"],
  ["âˆ'", "−"],
  ["â€”", "—"],
  ["â€“", "–"],
  ["â†'", "→"],
  ["Â·", "·"],
  ["â—†", ""],
  ["â€œ", '"'],
  ["â€\u009d", '"'],
  ["â€˜", "'"],
  ["â€™", "'"],
  ["command center", "primary desk"],
  ["Command center", "Primary desk"],
  ["text-slate-300", "text-secondary"],
  ["text-slate-400", "text-mute"],
  ["text-slate-500", "text-mute"],
  ["text-slate-600", "text-mute/70"],
  ["border-slate-800", "border-white/10"],
  ["border-slate-700", "border-white/12"],
  ["bg-slate-900/40", "bg-white/[0.03]"],
  ["bg-slate-900/30", "bg-white/[0.03]"],
  ["bg-slate-900/60", "bg-white/[0.05]"],
  ["bg-slate-800", "bg-white/[0.06]"],
  ["hover:border-slate-400/60", "hover:border-white/20"],
  ["border-slate-400/30", "border-white/12"],
];

/** Strip duplicate page chrome when LearnDoc is used from layout sidebar. */
function stripDuplicateShell(src) {
  if (!src.includes("LearnDoc")) return src;
  let next = src;
  // Remove full-page background wrapper if present
  next = next.replace(
    /<div className="min-h-screen" style=\{\{ backgroundColor: "#040407" \}\}>\s*/g,
    ""
  );
  next = next.replace(
    /<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">\s*/g,
    ""
  );
  // Remove duplicate page header block (LearnDoc provides header)
  next = next.replace(
    /\{\/\* Page header \*\/\}[\s\S]*?<\/div>\s*\n\s*<div className="flex gap-12 relative">/,
    ""
  );
  // Remove sticky aside TOC
  next = next.replace(
    /\{\/\* Sticky sidebar \*\/\}[\s\S]*?<\/aside>\s*\n\s*/,
    ""
  );
  // Unwrap main flex wrapper
  next = next.replace(/<main className="flex-1 min-w-0 space-y-16">/, "");
  next = next.replace(/<\/main>\s*<\/div>\s*<\/div>\s*<\/div>/, "");
  return next;
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name === "page.tsx") fixFile(p);
  }
}

function fixFile(file) {
  if (file.endsWith(`${path.sep}learn${path.sep}page.tsx`)) return;
  let src = fs.readFileSync(file, "utf8");
  let next = src;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  next = stripDuplicateShell(next);
  if (next !== src) {
    fs.writeFileSync(file, next, "utf8");
    console.log("fixed:", path.relative(process.cwd(), file));
  }
}

walk(ROOT);
console.log("done");
