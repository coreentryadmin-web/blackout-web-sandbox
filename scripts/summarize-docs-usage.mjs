#!/usr/bin/env node
/** Summarize documented vs codebase usage (no live probe). */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function templateToRegex(template) {
  const escaped = template
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function expandPathVariants(template) {
  const variants = [template];
  if (template.includes("/vX/")) {
    for (const v of ["v1", "v2", "v3"]) {
      variants.push(template.replace(/\/vX\//g, `/${v}/`));
    }
  }
  if (template.includes("/stocks/vX/")) {
    variants.push(template.replace("/stocks/vX/", "/stocks/v1/"));
  }
  if (template.includes("/v1/related-companies/")) {
    variants.push(template.replace("/v1/related-companies/", "/v3/reference/tickers/") + "/related");
  }
  return variants;
}

function isUsed(pathTemplate, usedPaths) {
  const variants = expandPathVariants(pathTemplate);
  for (const used of usedPaths) {
    for (const v of variants) {
      if (templateToRegex(v).test(used)) return true;
      if (used === v) return true;
      if (used.startsWith(pathTemplate.split("{")[0])) return true;
    }
  }
  if (pathTemplate.includes("/range/{") && usedPaths.some((u) => u.includes("/range/"))) return true;
  if (pathTemplate.includes("/snapshot/options/") && usedPaths.some((u) => u.includes("/snapshot/options"))) return true;
  if (pathTemplate.includes("/benzinga/") && usedPaths.some((u) => u.includes("/benzinga"))) return true;
  if (pathTemplate.includes("/marketstatus/") && usedPaths.some((u) => u.includes("/marketstatus"))) return true;
  if (pathTemplate.includes("/indicators/") && usedPaths.some((u) => u.includes("/indicators"))) return true;
  if (pathTemplate.includes("/short") && usedPaths.some((u) => u.includes("/short"))) return true;
  return false;
}

function loadUsage() {
  const content = readFileSync(join(root, "src/lib/cursor-api-analysis-data.ts"), "utf8");
  const json = content
    .replace(/^[\s\S]*?export const CURSOR_API_ANALYSIS = /, "")
    .replace(/ as const;\s*[\s\S]*$/, "");
  return JSON.parse(json);
}

function extractUwCatalog() {
  const content = readFileSync(join(root, "src/lib/uw-docs-catalog.ts"), "utf8");
  const endpoints = [];
  const sectionRe =
    /"id":\s*"([^"]+)"[\s\S]*?"title":\s*"([^"]+)"[\s\S]*?"endpoints":\s*\[([\s\S]*?)\n\s*\]/g;
  let sm;
  while ((sm = sectionRe.exec(content)) !== null) {
    const epRe = /"name":\s*"([^"]+)"[\s\S]*?"path":\s*"([^"]+)"/g;
    let em;
    while ((em = epRe.exec(sm[3])) !== null) {
      endpoints.push({
        section: sm[2],
        sectionId: sm[1],
        name: em[1],
        path: em[2],
      });
    }
  }
  return endpoints;
}

function extractPolygonDocs() {
  const files = [
    ["src/lib/polygon-docs-stocks-rest.ts", "polygon-stocks"],
    ["src/lib/polygon-docs-options-rest.ts", "polygon-options"],
    ["src/lib/polygon-docs-indices-rest.ts", "polygon-indices"],
    ["src/lib/polygon-docs-benzinga-rest.ts", "polygon-benzinga"],
  ];
  const endpoints = [];
  for (const [file, provider] of files) {
    const content = readFileSync(join(root, file), "utf8");
    const sectionRe = /id:\s*"([^"]+)"[\s\S]*?title:\s*"([^"]+)"[\s\S]*?endpoints:\s*\[([\s\S]*?)\n\s*\],/g;
    let sm;
    while ((sm = sectionRe.exec(content)) !== null) {
      const epRe = /name:\s*"([^"]+)"[\s\S]*?path:\s*"([^"]+)"/g;
      let em;
      while ((em = epRe.exec(sm[3])) !== null) {
        endpoints.push({
          provider,
          section: sm[2],
          name: em[1],
          path: em[2],
        });
      }
    }
    if (!endpoints.length && content.includes("BENZINGA_NEWS_PATH")) {
      const m = content.match(/BENZINGA_NEWS_PATH\s*=\s*"([^"]+)"/);
      if (m) {
        endpoints.push({
          provider: "polygon-benzinga",
          section: "Benzinga",
          name: "Real-time Benzinga News",
          path: m[1],
        });
      }
    }
  }
  return endpoints;
}

const usage = loadUsage();
const uwUsed = usage.external.unusual_whales.map((e) => e.path);
const polyUsed = usage.external.polygon.map((e) => e.path);

const uwEps = extractUwCatalog().map((e) => ({ ...e, used: isUsed(e.path, uwUsed) }));
const polyEps = extractPolygonDocs().map((e) => ({ ...e, used: isUsed(e.path, polyUsed) }));

const report = {
  generatedAt: new Date().toISOString(),
  codebaseUsageAt: usage.generatedAt,
  polygon: {
    documented: polyEps.length,
    used: polyEps.filter((e) => e.used).length,
    unused: polyEps.filter((e) => !e.used).length,
    unusedList: polyEps.filter((e) => !e.used),
    usedList: polyEps.filter((e) => e.used),
    codePathsNotInDocs: polyUsed.filter((p) => !polyEps.some((e) => isUsed(e.path, [p]))),
  },
  unusual_whales: {
    documented: uwEps.length,
    used: uwEps.filter((e) => e.used).length,
    unused: uwEps.filter((e) => !e.used).length,
    unusedBySection: Object.fromEntries(
      Object.entries(
        uwEps
          .filter((e) => !e.used)
          .reduce((acc, e) => {
            (acc[e.section] ??= []).push(e);
            return acc;
          }, {})
      ).sort((a, b) => b[1].length - a[1].length)
    ),
    unusedList: uwEps.filter((e) => !e.used),
    usedList: uwEps.filter((e) => e.used),
    codePathsNotInDocs: uwUsed.filter((p) => !uwEps.some((e) => isUsed(e.path, [p]))),
  },
};

writeFileSync(join(root, "src/lib/docs-usage-summary.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({
  polygon: { documented: report.polygon.documented, used: report.polygon.used, unused: report.polygon.unused },
  unusual_whales: { documented: report.unusual_whales.documented, used: report.unusual_whales.used, unused: report.unusual_whales.unused },
}, null, 2));
