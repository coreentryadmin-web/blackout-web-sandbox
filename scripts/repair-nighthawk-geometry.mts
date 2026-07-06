/**
 * One-shot repair: fix published Night Hawk plays whose persisted entry/target/stop fail
 * validatePlayGeometry (ops #519 — thin-edition backfill "Near $X" + stop=X bypass).
 *
 * Usage: npx tsx scripts/repair-nighthawk-geometry.mts [--dry-run] [--edition YYYY-MM-DD]
 */
import { createAuditClient, resolveAuditDbUrl } from "./pg-audit.mjs";
import { validatePlayGeometry } from "../src/lib/nighthawk/play-constraints.ts";
import { buildDirectionalStockLevels, parsePlayLevels } from "../src/lib/nighthawk/play-levels.ts";
import type { PlaybookPlay } from "../src/lib/nighthawk/types.ts";

function isoDateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error(`Cannot normalize edition_for date: ${s}`);
}

const dryRun = process.argv.includes("--dry-run");
const editionArg = process.argv.find((a) => a.startsWith("--edition="))?.split("=")[1];

function repairPlay(play: PlaybookPlay): PlaybookPlay | null {
  if (validatePlayGeometry(play).ok) return null;
  const { entry_range_low, entry_range_high, target, stop } = parsePlayLevels(play);
  const isShort = String(play.direction ?? "LONG").toUpperCase().includes("SHORT");
  const direction = isShort ? "short" : "long";
  const supportMatch = play.entry_range?.match(/Near\s*\$?([\d.]+)/i);
  const support = supportMatch ? Number(supportMatch[1]) : (
    stop ?? entry_range_low ?? entry_range_high
  );
  const resistance = target ?? entry_range_high ?? entry_range_low;
  if (support == null || resistance == null) return null;
  const levels = buildDirectionalStockLevels({ direction, support, resistance });
  return { ...play, entry_range: levels.entry_range, target: levels.target, stop: levels.stop };
}

async function main() {
  const dbUrl = resolveAuditDbUrl();
  if (!dbUrl) {
    console.error("DATABASE_PUBLIC_URL / DATABASE_URL not set");
    process.exit(1);
  }
  const client = createAuditClient(dbUrl);
  await client.connect();

  const res = editionArg
    ? await client.query(
        `SELECT edition_for, plays FROM nighthawk_editions WHERE edition_for = $1::date LIMIT 1`,
        [editionArg]
      )
    : await client.query(
        `SELECT edition_for, plays FROM nighthawk_editions ORDER BY published_at DESC LIMIT 1`
      );

  const row = res.rows[0];
  if (!row) {
    console.error("No edition found");
    process.exit(1);
  }

  const editionFor = editionArg ?? isoDateOnly(row.edition_for);
  const plays = (Array.isArray(row.plays) ? row.plays : []) as PlaybookPlay[];
  let repaired = 0;
  const nextPlays = plays.map((p) => {
    const fixed = repairPlay(p);
    if (!fixed) return p;
    repaired++;
    console.log(
      `[repair] ${p.ticker}: entry ${p.entry_range} → ${fixed.entry_range}, stop ${p.stop} → ${fixed.stop}`
    );
    return fixed;
  });

  if (!repaired) {
    console.log(`Edition ${editionFor}: all plays pass geometry — nothing to repair.`);
    await client.end();
    return;
  }

  for (const p of nextPlays) {
    const v = validatePlayGeometry(p);
    if (!v.ok) {
      console.error(`Post-repair ${p.ticker} still fails: ${v.drops.join("; ")}`);
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log(`[dry-run] Would repair ${repaired} play(s) on edition ${editionFor}`);
    await client.end();
    return;
  }

  await client.query(`UPDATE nighthawk_editions SET plays = $1::jsonb WHERE edition_for = $2::date`, [
    JSON.stringify(nextPlays),
    editionFor,
  ]);
  console.log(`Repaired ${repaired} play(s) on edition ${editionFor}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
