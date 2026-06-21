import { trackedFetch } from "@/lib/api-tracked-fetch";

// This module must only be imported from server-side code (API routes, Server
// Components, Server Actions).  It must never be bundled into the client.
if (typeof window !== "undefined") {
  throw new Error(
    "[engine] engine.ts was imported in a browser context. " +
      "This file is server-only and must not be included in the client bundle."
  );
}

const ENGINE_BASE = process.env.API_BASE?.replace(/\/$/, "") ?? "";
const ENGINE_KEY = process.env.DASHBOARD_API_SECRET ?? "";

export function engineConfigured(): boolean {
  return Boolean(ENGINE_BASE);
}

export async function fetchEngine<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  if (!ENGINE_BASE) {
    throw new Error("Engine not configured");
  }

  // Validate path to prevent SSRF via path traversal or protocol injection.
  const ALLOWED_PREFIXES = ["spx", "nighthawk", "largo", "health"];
  const pathWithoutLeadingSlash = path.replace(/^\/+/, "");
  const pathSegment = pathWithoutLeadingSlash.split("?")[0] ?? "";
  if (
    pathSegment.includes("..") ||
    pathSegment.includes("://") ||
    !ALLOWED_PREFIXES.some((prefix) => pathSegment === prefix || pathSegment.startsWith(`${prefix}/`))
  ) {
    throw Object.assign(new Error(`Invalid engine path: ${path}`), { status: 400 });
  }

  // Do NOT append the secret as a query-string parameter — query strings are
  // logged by proxies, servers, and telemetry layers.  Send it as a header.
  const sanitizedPath = `/${pathWithoutLeadingSlash}`;
  const url = `${ENGINE_BASE}${sanitizedPath}`;

  const pathOnly = sanitizedPath.split("?")[0] ?? sanitizedPath;
  const res = await trackedFetch("blackout_engine", pathOnly, url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ENGINE_KEY}`,
      ...options?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Engine ${path} → ${res.status}`);
  }

  return res.json() as Promise<T>;
}
