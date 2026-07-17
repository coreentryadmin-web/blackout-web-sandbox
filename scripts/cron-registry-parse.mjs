/**
 * Parse src/lib/cron-registry.ts for job keys + HTTP paths (no Railway coupling).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..");

export function registryEntries() {
  const raw = readFileSync(join(REPO_ROOT, "src/lib/cron-registry.ts"), "utf8");
  const blocks = [...raw.matchAll(/\{\s*key:\s*"([^"]+)"([\s\S]*?)\n\s*\},/g)];
  const entries = [];
  for (const m of blocks) {
    const key = m[1];
    const body = m[2];
    const pathMatch = body.match(/path:\s*"(\/api\/cron\/[^"]+)"/);
    entries.push({ key, path: pathMatch?.[1] ?? null });
  }
  return entries;
}

export function allCronKeys() {
  return registryEntries()
    .map((e) => e.key)
    .sort();
}
