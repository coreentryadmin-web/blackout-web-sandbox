import assert from "node:assert/strict";
import test from "node:test";
import { parseRedisInfo } from "./redis-health";

test("parseRedisInfo: extracts key:value fields, skips comments and blank lines", () => {
  const info = [
    "# Memory",
    "used_memory:52428800",
    "used_memory_human:50.00M",
    "",
    "# Clients",
    "connected_clients:7",
    "# Server",
    "uptime_in_seconds:7200",
  ].join("\r\n");
  const fields = parseRedisInfo(info);
  assert.equal(fields.used_memory, "52428800");
  assert.equal(fields.connected_clients, "7");
  assert.equal(fields.uptime_in_seconds, "7200");
  assert.equal(fields["# Memory"], undefined);
});

test("parseRedisInfo: empty input yields no fields, never throws", () => {
  assert.deepEqual(parseRedisInfo(""), {});
});

test("parseRedisInfo: tolerates values containing colons (e.g. a URL-shaped value)", () => {
  const fields = parseRedisInfo("master_replid:abc:def:123");
  assert.equal(fields.master_replid, "abc:def:123");
});
