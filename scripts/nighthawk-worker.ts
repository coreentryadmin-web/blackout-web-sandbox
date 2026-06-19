import { buildEveningEdition } from "@/lib/nighthawk/edition-builder";
import { ensureSchema } from "@/lib/db";

async function main() {
  await ensureSchema();
  const force = process.argv.includes("--force");
  const result = await buildEveningEdition({ force });
  console.log("[nighthawk-worker] result:", JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[nighthawk-worker] fatal:", e);
  process.exit(1);
});
