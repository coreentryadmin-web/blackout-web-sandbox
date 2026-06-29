#!/usr/bin/env node
/**
 * Vendor-surface guard — user-facing copy must not name upstream providers.
 * Scans premium/marketing/auth UI paths only (admin + lib internals excluded).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = [
  "src/components/grid",
  "src/components/landing",
  "src/components/auth",
  "src/components/upgrade",
  "src/components/desk/EngineStatusBar.tsx",
  "src/components/desk/SectorThermal.tsx",
  "src/components/desk/LargoThinkingState.tsx",
  "src/app/(site)",
];
const EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".mdx"]);
const VENDORS =
  /\b(?:Polygon|Massive|Unusual Whales|Anthropic|Claude|Clerk|Whop|Redis|Postgres|Sentry)\b/;

function stripComments(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/g, "");
}

const hits = [];

function scanFile(p) {
  if (!EXTS.has(extname(p))) return;
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("import ") || line.includes("from @") || line.includes("ClerkProvider")) return;
    const stripped = stripComments(line);
    if (!stripped.trim()) return;
    const m = stripped.match(VENDORS);
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
