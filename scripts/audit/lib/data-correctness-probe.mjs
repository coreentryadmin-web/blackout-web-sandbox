/**
 * Probe data-correctness from external HTTP (Cloudflare ~100s cap).
 * Full-platform `?force=1` often 524s through the edge; Railway cron runs internally.
 * This runs the heatmap surface (GEX oracle + cross-tool) under the timeout, then
 * optionally records that the full sweep was skipped.
 */
import { fetchRetry } from "./fetch-retry.mjs";
export async function probeDataCorrectness({
  base,
  cronSecret,
  timeoutMs = 110_000,
  tryFull = false,
}) {
  const headers = { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" };
  const mk = (mode, status, json, err) => ({
    mode,
    status,
    json,
    err,
    flags: json?.flags?.length ?? json?.totals?.flags ?? 0,
    ok: status === 200 && json?.ok !== false && !(json?.flags?.length > 0),
  });

  if (tryFull) {
    const full = await fetchWithTimeout(`${base}/api/cron/data-correctness?force=1`, headers, timeoutMs);
    if (full.status === 200 && full.json) {
      return mk("full", 200, full.json);
    }
  }

  const hm = await fetchWithTimeout(
    `${base}/api/cron/data-correctness?force=1&surface=heatmap`,
    headers,
    timeoutMs
  );
  if (hm.status === 200 && hm.json) {
    return { ...mk("heatmap", 200, hm.json), fullSweepSkipped: !tryFull || hm.status !== 200 };
  }

  return mk("heatmap", hm.status || 0, hm.json, hm.err || `HTTP ${hm.status}`);
}

async function fetchWithTimeout(url, headers, timeoutMs) {
  try {
    const r = await fetchRetry(url, { headers }, { retries: 4, baseDelayMs: 1500, timeoutMs });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML 524 page */
    }
    if (!json && r.status >= 500) {
      return { status: r.status, json: null, err: text.slice(0, 120) };
    }
    return { status: r.status, json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, json: null, err: msg };
  }
}
