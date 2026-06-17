import { trackedFetch } from "@/lib/api-tracked-fetch";

const ENGINE_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "";
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

  const separator = path.includes("?") ? "&" : "?";
  const url = `${ENGINE_BASE}${path}${separator}key=${encodeURIComponent(ENGINE_KEY)}`;

  const pathOnly = path.split("?")[0] ?? path;
  const res = await trackedFetch("blackout_engine", pathOnly, url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Blackout-Key": ENGINE_KEY,
      ...options?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Engine ${path} → ${res.status}`);
  }

  return res.json() as Promise<T>;
}
