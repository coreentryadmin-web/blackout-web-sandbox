#!/usr/bin/env node
/**
 * Vendor-surface guard — user-facing copy must not name upstream providers.
 * Scans premium/marketing/auth UI paths only (admin + lib internals excluded).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = [
  "src/components/landing",
  "src/components/auth",
  "src/components/upgrade",
  "src/features/largo/components/LargoThinkingState.tsx",
  "src/app/(site)",
];
const EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".mdx"]);
const VENDORS =
  /\b(?:Polygon|Massive|Unusual Whales|Anthropic|Claude|Clerk|Whop|Redis|Postgres|Sentry|Voyage|Vercel)\b/;

const hits = [];

/**
 * Strips comments from a file's source, tracking `/* ... *\/` block-comment
 * state ACROSS lines. The previous per-line-only stripper missed a block
 * comment whose opening line (`/** some text` with no closing `*\/` on that
 * same line — the common JSDoc style) had real content after `/**`, letting a
 * vendor name in a doc-comment's first line slip through as a false positive.
 * Returns one "stripped" string per input line, same indexing as the input.
 */
function stripCommentsAcrossLines(lines) {
  let inBlockComment = false;
  return lines.map((line) => {
    let working = line;
    if (inBlockComment) {
      const end = working.indexOf("*/");
      if (end === -1) return ""; // whole line still inside the block comment
      working = working.slice(end + 2);
      inBlockComment = false;
    }
    // Strip any block comments that both open and close on this line (may be more than one).
    working = working.replace(/\/\*[\s\S]*?\*\//g, "");
    // A block comment that OPENS here but doesn't close on this line — keep only
    // what precedes it, and carry the open state into the next line.
    const openIdx = working.indexOf("/*");
    if (openIdx !== -1) {
      working = working.slice(0, openIdx);
      inBlockComment = true;
    }
    return working.replace(/\/\/.*$/, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  });
}

function scanFile(p) {
  if (!EXTS.has(extname(p))) return;
  // Test descriptions/comments are developer-facing (test-runner output only),
  // never rendered to a real user — exempt from the user-facing-copy guard.
  if (p.endsWith(".test.ts") || p.endsWith(".test.tsx")) return;
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  const stripped = stripCommentsAcrossLines(lines);
  lines.forEach((line, i) => {
    if (line.includes("import ") || line.includes("from @") || line.includes("ClerkProvider")) return;
    if (!stripped[i].trim()) return;
    const m = stripped[i].match(VENDORS);
    if (m) hits.push(`${p}:${i + 1}  ${m[0]}`);
  });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else scanFile(p);
  }
}

for (const root of ROOTS) {
  try {
    if (statSync(root).isDirectory()) walk(root);
    else scanFile(root);
  } catch {
    /* optional path */
  }
}

if (hits.length) {
  console.error(
    `✗ Vendor surface guard: ${hits.length} provider name(s) in user-facing UI — use neutral labels:\n`
  );
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("✓ Vendor surface guard: no provider names in scanned user-facing UI.");
