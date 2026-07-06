import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Task #170 (DoS/resource-exhaustion audit): unlike its 3 SSE siblings (market/flows/stream,
// market/spx/pulse/stream, admin/apis/stream), this route had NEITHER a per-instance
// activeStreams/MAX_STREAMS cap NOR a backpressure check before enqueue — a single valid
// premium session could open unbounded connections and never read the body, growing every
// un-drained connection's internal queue without limit. These tests cover the two protections
// the fix ports in from flows/stream: (1) the cap returns 503 once hit (and un-caps once a
// connection disconnects), and (2) a stalled/non-reading client trips backpressure and its
// stream is torn down instead of the queue growing unbounded.
//
// MAX_STREAMS is read from process.env.POSITIONS_SSE_MAX_STREAMS at module-load time, so it
// must be set BEFORE the dynamic import of "./route" in before() — that import is the only one
// for the whole file (ESM caches a module on first import), so every test below shares the
// same MAX_STREAMS = 2.
//
// mock.module() resolves bare specifiers relative to THIS file, not the "@/" tsconfig alias
// — see src/lib/__tests__/critical-api-routes.test.ts for the same pattern.

process.env.POSITIONS_SSE_MAX_STREAMS = "2";

const mockGate: { userId: string; tier: "premium" } = { userId: "user_1", tier: "premium" };
const mockToolLock: Response | null = null;
const mockPositions: unknown[] = [];

mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    requireTierApi: async () => mockGate,
  },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: {
    requireToolApi: async () => mockToolLock,
  },
});
mock.module("../../../../../lib/ws/init-data-sockets", {
  namedExports: { ensureDataSockets: () => {} },
});
mock.module("../../../../../lib/nights-watch/enrichment", {
  namedExports: {
    getEnrichedOpenAndRecentClosedForUser: async () => mockPositions,
  },
});

// Real (unmocked) setTimeout, captured before any test enables fake timers, for tests that
// need a real-clock safety net (e.g. failing fast instead of hanging forever if a stream never
// closes the way it's supposed to).
const realSetTimeout = globalThis.setTimeout;

function flushMicrotasks(times = 3): Promise<void> {
  return times <= 0 ? Promise.resolve() : Promise.resolve().then(() => flushMicrotasks(times - 1));
}

let GET: (req: Request) => Promise<Response>;

// A never-reading "slow-loris" client: opens the connection via GET() and returns a way to
// abort it — matching the exploit scenario (open the connection, never drain the body).
function openConnection(): { res: Promise<Response>; abort: () => void } {
  const ac = new AbortController();
  const req = new Request("http://localhost/api/account/positions/stream", { signal: ac.signal });
  return { res: GET(req), abort: () => ac.abort() };
}

describe("/api/account/positions/stream — connection cap + backpressure (task #170)", () => {
  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("rejects a new connection with 503 once MAX_STREAMS (2) are already active, and un-caps on disconnect", async () => {
    // Every opened connection is aborted in `finally`, even ones the test doesn't expect to
    // succeed — a regression here (e.g. the cap silently not applying) would otherwise leave a
    // real un-mocked heartbeat/push timer chain running forever and hang the whole test file
    // instead of failing fast.
    const opened: Array<() => void> = [];
    try {
      const first = openConnection();
      opened.push(first.abort);
      const second = openConnection();
      opened.push(second.abort);
      const firstRes = await first.res;
      const secondRes = await second.res;
      assert.equal(firstRes.status, 200);
      assert.equal(secondRes.status, 200);

      // A third connection while the first two are still open must be rejected — this is the
      // exact gap task #170 found: previously NOTHING stopped a single session opening
      // unlimited connections here.
      const third = openConnection();
      opened.push(third.abort);
      const thirdRes = await third.res;
      assert.equal(thirdRes.status, 503);

      // Disconnect both open (successful) connections and let their abort listeners'
      // cleanup() run (decrementing activeStreams) before checking the counter un-caps.
      first.abort();
      second.abort();
      await flushMicrotasks();

      const after = openConnection();
      opened.push(after.abort);
      const afterRes = await after.res;
      assert.equal(afterRes.status, 200, "activeStreams should be back to 0 after both connections disconnected");
    } finally {
      for (const abort of opened) abort();
      await flushMicrotasks();
    }
  });

  test("a stalled client that never reads trips backpressure and the stream closes instead of growing unbounded", async (t) => {
    // Lower the backpressure threshold to 1 queued chunk so the fix's guard trips after just a
    // couple of un-drained pushes instead of needing 64 real ones; sseBackpressureExceeded()
    // re-reads this env var on every call (it's a default-parameter, evaluated per invocation,
    // not cached at module load — see sse-backpressure.ts).
    const prevMaxQueued = process.env.SSE_MAX_QUEUED_CHUNKS;
    process.env.SSE_MAX_QUEUED_CHUNKS = "1";
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });

    const conn = openConnection();
    try {
      const res = await conn.res;
      assert.equal(res.status, 200);
      const reader = res.body!.getReader();

      const readWithTimeout = () =>
        Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            realSetTimeout(() => reject(new Error("reader.read() never resolved — stream should have closed")), 500);
          }),
        ]);

      // Never call reader.read() while ticking — the client just holds the connection open
      // without draining it, exactly like the exploit scenario. Advance the per-connection
      // 3s push timer well past the point where backpressure should have tripped and torn the
      // connection down; further ticks past that point must be no-ops (nothing left scheduled).
      for (let i = 0; i < 8; i++) {
        t.mock.timers.tick(3_000);
        await flushMicrotasks();
      }

      const chunks: Uint8Array[] = [];
      let result = await readWithTimeout();
      let guard = 0;
      while (!result.done && guard < 5) {
        chunks.push(result.value);
        result = await readWithTimeout();
        guard++;
      }

      assert.equal(result.done, true, "backpressure should close the stream, not let it run forever");
      assert.ok(chunks.length >= 1, "the first legitimate push should have gone through before backpressure tripped");
      assert.ok(
        chunks.length <= 2,
        `expected only a couple of buffered chunks before the backpressure guard closed the connection, got ${chunks.length}`,
      );
    } finally {
      if (prevMaxQueued === undefined) delete process.env.SSE_MAX_QUEUED_CHUNKS;
      else process.env.SSE_MAX_QUEUED_CHUNKS = prevMaxQueued;
      conn.abort();
    }
  });
});
