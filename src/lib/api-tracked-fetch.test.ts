import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { trackedFetch, __allowFetchHostForTest } from "./api-tracked-fetch";

// The host-allowlist guard (SSRF hardening) rejects any destination outside this app's
// known providers by default — these tests need their own local ephemeral server allowed.
__allowFetchHostForTest("127.0.0.1");

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("expected AddressInfo");
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// Regression test for the live GEX-heatmap/gex-positioning production incident: a stalled
// upstream Polygon connection hung the calling request indefinitely because bare fetch() has
// no timeout and no caller passed a `signal`. This server never responds, simulating that hang.
test("trackedFetch aborts a stalled request instead of hanging forever", async () => {
  const server = createServer(() => {
    // Never call res.end() — the connection just hangs, like the live api.massive.com incident.
  });
  const base = await listen(server);
  try {
    const start = Date.now();
    await assert.rejects(
      () => trackedFetch("polygon", "/test", `${base}/hang`, { timeoutMs: 50 }),
      /timeout/i
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `expected a fast abort, took ${elapsed}ms`);
  } finally {
    server.close();
  }
});

test("trackedFetch still returns a fast, healthy response normally", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const base = await listen(server);
  try {
    const res = await trackedFetch("polygon", "/test", `${base}/ok`, { timeoutMs: 5000 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.close();
  }
});

test("trackedFetch honors a caller-supplied signal alongside the default timeout", async () => {
  const server = createServer(() => {
    // Hangs — the caller's own controller should win here since it fires first.
  });
  const base = await listen(server);
  const controller = new AbortController();
  try {
    const pending = trackedFetch("polygon", "/test", `${base}/hang`, {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(() => pending);
  } finally {
    server.close();
  }
});

// SSRF hardening (request-forgery, FINDINGS.md): trackedFetch is the single network-egress
// choke point for every provider this app calls. Per-fragment ticker/path sanitizers at each
// call site (safeTicker, resolveOptionsRoot, etc.) close injection there, but a future
// unsanitized caller could still slip through — this is the backstop that closes the whole
// bug class at the one place every flow must pass through, regardless of how its URL was
// built upstream.
test("trackedFetch refuses to fetch a host outside the known-provider allowlist, without ever attempting the network call", async () => {
  await assert.rejects(
    () => trackedFetch("polygon", "/test", "https://evil.example.com/exfiltrate"),
    /disallowed host/i
  );
});

test("trackedFetch refuses a disallowed host even when it's just a differently-cased/subdomain lookalike of a real provider", async () => {
  await assert.rejects(
    () => trackedFetch("unusual_whales", "/test", "https://api.unusualwhales.com.evil.com/x"),
    /disallowed host/i
  );
});
