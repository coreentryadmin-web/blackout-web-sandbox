import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("member /api/market/spx/play delegates to getSpxPlayState (single derivation)", () => {
  const route = readFileSync(join(ROOT, "app/api/market/spx/play/route.ts"), "utf8");
  assert.match(route, /getSpxPlayState/);
  assert.doesNotMatch(route, /readSpxPlaySnapshot/);
  assert.doesNotMatch(route, /buildPlayTechnicals/);
  assert.doesNotMatch(route, /staleWhileRevalidate/);
});

test("getSpxPlayState owns the shared play-read cache (member + BIE + Largo)", () => {
  const service = readFileSync(join(ROOT, "features/spx/lib/spx-service.ts"), "utf8");
  assert.match(service, /withServerCache\(`spx-play-read:\$\{date\}`/);
  assert.match(service, /playMemberReadCacheSec/);
  assert.doesNotMatch(service, /staleWhileRevalidate/);
});
