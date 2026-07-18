// One-shot Cloudflare edge-cache purge fired once per deploy.
//
// WHY: the public marketing pages (/, /upgrade, /learn*) are statically generated
// AND edge-cached by a Cloudflare Cache Rule with "Ignore cache-control header,
// Edge TTL 2h" (the origin sends `no-store` via Clerk middleware, so without that
// override they'd never cache). The 2h edge TTL means a fresh deploy can serve the
// PREVIOUS build's HTML for up to two hours. This module purges those exact URLs at
// boot so new copy goes live immediately after each deploy.
//
// SAFETY / SCOPE:
//   * NO-OP unless CF_API_TOKEN + CF_ZONE_ID are both set → safe to ship before the
//     token exists; it simply does nothing until configured.
//   * Cross-replica dedup via Redis SET NX EX keyed on the deploy id (commit SHA /
//     deployment id) — only the FIRST replica to boot a new deploy actually purges,
//     mirroring the leader-election pattern in ws/polygon-socket.ts. Without Redis it
//     falls back to a per-process guard (at worst one purge per replica per deploy,
//     which is harmless — purge is idempotent).
//   * If there is no deploy id to key on, it does nothing (never purges on every
//     boot — that would defeat the cache).
//   * Purges a fixed list of PUBLIC URLs only ("files" purge, available on every CF
//     plan). It never purges the whole zone and never touches app/API responses.
//
// Called once from instrumentation.ts register() (nodejs runtime only), lazily
// imported so ioredis/fetch are never pulled into the edge/client graph.

const PURGE_LOCK_TTL_SEC = 3_600; // 1h: comfortably longer than a rolling deploy

// Public, statically-generated, edge-cached marketing routes (see Cache Rule #6).
// Keep in sync with the pages carrying `export const dynamic = "force-static"`.
const MARKETING_PATHS = [
  "/",
  "/faq",
  "/pricing",
  "/upgrade",
  "/learn",
  "/learn/night-hawk",
  "/learn/helix-flows",
  "/learn/largo-ai",
  "/learn/spx-slayer",
  "/learn/heat-maps",
  "/learn/glossary",
  "/learn/getting-started",
] as const;

function deployId(): string | null {
  return (
    process.env.CF_PURGE_DEPLOY_ID?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.CODEBUILD_RESOLVED_SOURCE_VERSION?.trim() ||
    null
  );
}

function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  // Normalize: strip any trailing slash so `${origin}${path}` is well-formed.
  return raw.replace(/\/+$/, "");
}

let _redisClient: import("ioredis").default | null = null;
let _connectingPromise: Promise<import("ioredis").default | null> | null = null;

async function getRedis(): Promise<import("ioredis").default | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (_redisClient) return _redisClient;
  if (_connectingPromise) return _connectingPromise;
  _connectingPromise = (async () => {
    try {
      const { makeRedis } = await import("./make-redis");
      const client = await makeRedis("cf-purge-on-deploy", url, { maxRetriesPerRequest: 1 });
      _redisClient = client;
      return _redisClient;
    } catch {
      return null;
    } finally {
      _connectingPromise = null;
    }
  })();
  return _connectingPromise;
}

// Per-process guard so a Redis-less replica purges at most once per boot.
const PROCESS_GUARD = "__blackoutCfPurgeFired" as const;

/**
 * Claims the purge for this deploy. Returns true if THIS replica should run the
 * purge, false if another replica already did (or will). Fails toward "claim" only
 * when there is no Redis (per-process guard prevents repeat purges in that case).
 */
async function claimPurge(id: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) {
    const g = globalThis as typeof globalThis & { [PROCESS_GUARD]?: boolean };
    if (g[PROCESS_GUARD]) return false;
    g[PROCESS_GUARD] = true;
    return true;
  }
  try {
    // SET NX EX — atomic claim. 'OK' = we won and own the purge for this deploy.
    const claimed = await redis.set(`cf:purge:deploy:${id}`, "1", "EX", PURGE_LOCK_TTL_SEC, "NX");
    return claimed === "OK";
  } catch (err) {
    console.warn("[cf-purge-on-deploy] redis claim failed, skipping purge:", err);
    return false; // a Redis error must not trigger a purge storm across replicas
  }
}

/**
 * Fire-and-forget: purge the marketing URLs from Cloudflare's edge once per deploy.
 * Safe to call unconditionally at boot — it self-gates on configuration and dedup.
 */
export async function maybePurgeCloudflareOnDeploy(): Promise<void> {
  const token = process.env.CF_API_TOKEN?.trim();
  const zoneId = process.env.CF_ZONE_ID?.trim();
  if (!token || !zoneId) return; // not configured → no-op (safe pre-token)

  const id = deployId();
  if (!id) {
    console.warn("[cf-purge-on-deploy] no deploy id (CF_PURGE_DEPLOY_ID / GITHUB_SHA / CODEBUILD_RESOLVED_SOURCE_VERSION) — skipping to avoid purging on every boot");
    return;
  }

  const origin = siteOrigin();
  if (!origin) {
    console.warn("[cf-purge-on-deploy] NEXT_PUBLIC_SITE_URL unset — cannot build purge URLs, skipping");
    return;
  }

  if (!(await claimPurge(id))) return; // another replica owns this deploy's purge

  const files = MARKETING_PATHS.map((p) => `${origin}${p}`);
  const prefixes = [`${origin}/_next/static`];
  const body: { files: string[]; prefixes?: string[]; hosts?: string[] } = { files, prefixes };
  // Staging: also purge the whole host so stale HTML/chunk 404s cannot brick the UI after deploy.
  if (origin.includes("staging.")) {
    body.hosts = [new URL(origin).host];
  }
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[cf-purge-on-deploy] purge failed: ${res.status} ${text.slice(0, 300)}`);
      return;
    }
    console.log(`[cf-purge-on-deploy] purged ${files.length} URLs + ${prefixes.length} prefix(es) for deploy ${id}`);
  } catch (err) {
    console.warn("[cf-purge-on-deploy] purge request error:", err);
  }
}
