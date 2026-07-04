import { test } from "node:test";
import assert from "node:assert/strict";
import { newLockToken, releaseFencedLock, renewFencedLock } from "./leader-lock-fencing";

/** In-memory stand-in for ioredis's `eval`, running the exact same GET/EXPIRE/DEL semantics. */
function fakeRedis(initial: Map<string, string>) {
  const store = initial;
  return {
    async eval(script: string, _numkeys: number, ...args: Array<string | number>): Promise<unknown> {
      const key = String(args[0]);
      const token = String(args[1]);
      const current = store.get(key);
      if (script.includes("expire")) {
        if (current !== token) return 0;
        return 1; // TTL renewal itself isn't modeled — only the ownership check matters here
      }
      // release script
      if (current !== token) return 0;
      store.delete(key);
      return 1;
    },
  };
}

test("renewFencedLock: succeeds when the key still holds my token", async () => {
  const token = newLockToken();
  const redis = fakeRedis(new Map([["k", token]]));
  assert.equal(await renewFencedLock(redis, "k", token, 25), true);
});

test("renewFencedLock: fails when another replica's token now owns the key (leadership lost)", async () => {
  const myToken = newLockToken();
  const otherToken = newLockToken();
  const redis = fakeRedis(new Map([["k", otherToken]]));
  assert.equal(await renewFencedLock(redis, "k", myToken, 25), false);
});

test("releaseFencedLock: deletes the key when it still holds my token", async () => {
  const token = newLockToken();
  const store = new Map([["k", token]]);
  const redis = fakeRedis(store);
  await releaseFencedLock(redis, "k", token);
  assert.equal(store.has("k"), false);
});

test("releaseFencedLock: does NOT delete a lock now owned by a different replica", async () => {
  const myToken = newLockToken();
  const otherToken = newLockToken();
  const store = new Map([["k", otherToken]]);
  const redis = fakeRedis(store);
  await releaseFencedLock(redis, "k", myToken);
  assert.equal(store.get("k"), otherToken); // must survive — releasing a stale token is a no-op
});

test("newLockToken: two calls never collide", () => {
  const seen = new Set(Array.from({ length: 50 }, () => newLockToken()));
  assert.equal(seen.size, 50);
});
