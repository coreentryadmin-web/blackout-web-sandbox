import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

describe("prefetchLargoLiveFeed", () => {
  it("boots sockets and warms desk + market context", async () => {
    let sockets = 0;
    let desk = 0;
    let market = 0;

    mock.module("@/lib/ws/init-data-sockets", {
      namedExports: {
        ensureDataSockets: () => {
          sockets++;
        },
      },
    });
    mock.module("@/lib/bie/platform-cache", {
      namedExports: {
        getCachedBiePlatformContext: async (opts: { scope?: string }) => {
          if (opts.scope === "desk") desk++;
          if (opts.scope === "market") market++;
          return { as_of: new Date().toISOString() };
        },
      },
    });

    const { prefetchLargoLiveFeed } = await import("./largo-live-prefetch");
    await prefetchLargoLiveFeed({ blockMs: 100 });

    assert.equal(sockets, 1);
    assert.equal(desk, 1);
    assert.equal(market, 1);
  });
});
