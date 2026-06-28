#!/usr/bin/env node
/**
 * Repair common UTF-8 mojibake + migrate learn pages off banned slate utilities.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src", "app", "(site)", "learn");

const REPLACEMENTS = [
  ["â€”", "—"],
  ["â€“", "–"],
  ["â†'", "→"],
  ["Â·", "·"],
  ["â—†", ""],
  ["â€œ", '"'],
  ["â€\u009d", '"'],
  ["â€˜", "'"],
  ["â€™", "'"],
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

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith(".tsx") || ent.name.endsWith(".ts")) fixFile(p);
  }
}

function fixFile(file) {
  let src = fs.readFileSync(file, "utf8");
  let next = src;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  next = next.replace(/  +/g, (m) => (m.includes("\n") ? m : m));
  if (next !== src) {
    fs.writeFileSync(file, next, "utf8");
    console.log("fixed:", path.relative(process.cwd(), file));
  }
}

walk(ROOT);
console.log("done");
