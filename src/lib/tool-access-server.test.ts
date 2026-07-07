import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("requireToolApiForDeskCaller: cron skips launch gate; user hits coming_soon when tool locked", async () => {
  mock.module("server-only", { namedExports: {} });
  mock.module("./tool-access", {
    namedExports: {
      isToolLaunched: () => false,
    },
  });
  mock.module("./admin-access", {
    namedExports: {
      getAdminStatus: async () => ({ admin: false }),
      resolveAdminApi: async () => ({ actor: null }),
    },
  });

  const { requireToolApiForDeskCaller } = await import("./tool-access-server");

  const cronOk = await requireToolApiForDeskCaller({ userId: null, via: "cron" }, "heatmap");
  assert.equal(cronOk, null);

  const userDenied = await requireToolApiForDeskCaller({ userId: "user_1", via: "user" }, "heatmap");
  assert.ok(userDenied instanceof Response);
  assert.equal(userDenied!.status, 403);
  const body = await userDenied!.json();
  assert.equal(body.error, "coming_soon");
});
