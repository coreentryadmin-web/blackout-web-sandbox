#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const LEARN = path.join(process.cwd(), "src", "app", "(site)", "learn");

function extractTitle(src) {
  const h1 = src.match(/<h1[^>]*>\s*([\s\S]*?)<\/h1>/);
  if (h1) return h1[1].replace(/\s+/g, " ").trim();
  const meta = src.match(/title:\s*"([^"|]+)/);
  return meta ? meta[1].trim() : "Learn";
}

function extractDesc(src) {
  const p = src.match(/<p className="[^"]*text-(?:secondary|sky-300)[^"]*"[^>]*>\s*([\s\S]*?)<\/p>/);
  if (p) return p[1].replace(/\s+/g, " ").replace(/\{[^}]+\}/g, "").trim();
  const meta = src.match(/description:\s*\n?\s*"([^"]+)"/s);
  return meta ? meta[1].replace(/\s+/g, " ").trim() : "";
}

function extractSectionsConst(src) {
  const m = src.match(/const (sections|TOC) =/);
  return m ? m[1] : null;
}

function wrapPage(file) {
  let src = fs.readFileSync(file, "utf8");
  if (src.includes("LearnDoc")) return;

  const sec = extractSectionsConst(src);
  const title = extractTitle(src);
  const description = extractDesc(src);

  if (!src.includes('import { LearnDoc }')) {
    src = src.replace(
      /(import type \{ Metadata \} from "next";)/,
      '$1\nimport { LearnDoc } from "@/components/learn/LearnDoc";'
    );
  }

  // Drop outer shell through sidebar into content
  src = src.replace(
    /export default function \w+\(\) \{\s*return \(\s*<div className="min-h-screen[\s\S]*?(?:<main className="flex-1[^"]*">|<div className="flex-1[^"]*">)/,
    `export default function Page() {\n  return (\n    <LearnDoc\n      title="${title.replace(/"/g, '\\"')}"\n      description="${description.replace(/"/g, '\\"')}"${sec ? `\n      sections={${sec}}` : ""}\n    >\n`
  );

  // Close wrappers at end
  src = src.replace(/\s*<\/main>\s*<\/div>\s*<\/div>\s*<\/div>\s*\);\s*\}\s*$/, "\n    </LearnDoc>\n  );\n}\n");
  src = src.replace(/\s*<\/div>\s*<\/div>\s*<\/div>\s*\);\s*\}\s*$/, "\n    </LearnDoc>\n  );\n}\n");
  src = src.replace(/\s*<\/div>\s*<\/div>\s*\);\s*\}\s*$/, "\n    </LearnDoc>\n  );\n}\n");

  if (!src.includes("<LearnDoc")) return;
  fs.writeFileSync(file, src, "utf8");
  console.log("wrapped:", path.relative(process.cwd(), file));
}

for (const ent of fs.readdirSync(LEARN, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  const page = path.join(LEARN, ent.name, "page.tsx");
  if (fs.existsSync(page)) wrapPage(page);
}

console.log("done");
