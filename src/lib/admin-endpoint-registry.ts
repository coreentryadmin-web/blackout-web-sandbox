import { readFileSync } from "fs";
import { join } from "path";
import { CURSOR_API_ANALYSIS } from "@/lib/cursor-api-analysis-data";
import { DOCS_PROBE_REPORT } from "@/lib/docs-probe-report";
import {
  API_PROVIDER_CATALOG,
  type CatalogEndpoint,
} from "@/lib/api-provider-catalog";
import {
  getApiTelemetrySnapshot,
  type ApiEndpointStats,
  type ApiProviderId,
} from "@/lib/api-telemetry";
import {
  polygonConfigured,
  uwConfigured,
  finnhubConfigured,
} from "@/lib/providers/config";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { engineConfigured } from "@/lib/engine";
import { dbConfigured } from "@/lib/db";
import { webSearchConfigured } from "@/lib/providers/web-search";

export type RegistryProbeStatus = "ok" | "fail" | "blocked" | "rate_limited" | "unknown";

export type RegistryEndpointRow = {
  id: string;
  provider: string;
  providerLabel: string;
  section: string;
  name: string;
  path: string;
  pathTemplate: string;
  documented: boolean;
  usedInCode: boolean;
  sourceFiles: string[];
  catalogUsedBy: string[];
  catalogDescription: string | null;
  probeStatus: RegistryProbeStatus;
  probeHttp: number | null;
  probeMs: number | null;
  probeNote: string | null;
  probeBlocked: boolean;
  telemetry: ApiEndpointStats | null;
  runtimeStatus: "ok" | "error" | "idle" | "unconfigured" | "unknown";
  integrationCandidate: boolean;
  productionRisk: boolean;
};

export type RegistryProviderHealth = {
  id: ApiProviderId | string;
  name: string;
  configured: boolean;
  documentedTotal: number;
  usedTotal: number;
  unusedTotal: number;
  probeOk: number;
  probeFail: number;
  telemetryCalls: number;
  telemetryErrors: number;
};

export type EndpointRegistryPayload = {
  generated_at: string;
  codebase_scanned_at: string;
  probe_completed_at: string | null;
  summary: {
    documented_total: number;
    used_in_code: number;
    unused_in_code: number;
    integration_candidates: number;
    production_risks: number;
    probe_ok: number;
    probe_fail: number;
    probe_blocked: number;
    internal_routes: number;
    code_only_paths: number;
    runtime_calls_window: number;
    runtime_errors_window: number;
    window_label: string;
  };
  providers: RegistryProviderHealth[];
  endpoints: RegistryEndpointRow[];
  internalRoutes: { method: string; path: string; file: string }[];
  codeOnlyPaths: { provider: string; path: string; files: string[] }[];
};

function normalizePath(path: string): string {
  return path
    .replace(/\$\{[^}]+\}/g, "{param}")
    .replace(/\{[^}]+\}/g, "{*}")
    .replace(/\/\d+/g, "/{*}")
    .replace(/\/+$/, "");
}

function pathsMatch(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (na === nb) return true;
  const prefixA = a.split("{")[0];
  const prefixB = b.split("{")[0];
  return na.startsWith(nb) || nb.startsWith(na) || prefixA === prefixB;
}

function probeToStatus(probe: {
  ok: boolean;
  blocked: boolean;
  status: number;
} | null): RegistryProbeStatus {
  if (!probe) return "unknown";
  if (probe.ok) return "ok";
  if (probe.blocked) return "blocked";
  if (probe.status === 429) return "rate_limited";
  return "fail";
}

function mapDocProvider(provider: string): { id: string; label: string; telemetryId: ApiProviderId | null } {
  if (provider.startsWith("polygon")) {
    return { id: "polygon", label: "Polygon / Massive", telemetryId: "polygon" };
  }
  if (provider === "unusual_whales") {
    return { id: "unusual_whales", label: "Unusual Whales", telemetryId: "unusual_whales" };
  }
  return { id: provider, label: provider, telemetryId: null };
}

function isProviderConfigured(id: string): boolean {
  switch (id) {
    case "polygon":
      return polygonConfigured();
    case "unusual_whales":
      return uwConfigured();
    case "finnhub":
      return finnhubConfigured();
    case "anthropic":
      return anthropicConfigured();
    case "blackout_engine":
    case "engine":
      return engineConfigured();
    case "postgres":
      return dbConfigured();
    case "web_search":
      return webSearchConfigured();
    default:
      return true;
  }
}

function findCatalogMeta(path: string, providerId: string): CatalogEndpoint | null {
  const catalog = API_PROVIDER_CATALOG.find((p) => p.id === providerId);
  if (!catalog) return null;
  return (
    catalog.endpoints.find((ep) => pathsMatch(ep.endpoint, path)) ??
    catalog.endpoints.find((ep) => path.includes(ep.endpoint.split("{")[0])) ??
    null
  );
}

function findTelemetry(
  path: string,
  telemetryId: ApiProviderId | null,
  allStats: ApiEndpointStats[]
): ApiEndpointStats | null {
  if (!telemetryId) return null;
  let best: ApiEndpointStats | null = null;
  for (const s of allStats) {
    if (pathsMatch(s.endpoint, path)) {
      if (!best || (s.last_at && (!best.last_at || s.last_at > best.last_at))) {
        best = s;
      }
    }
  }
  return best;
}

function runtimeStatus(
  configured: boolean,
  telemetry: ApiEndpointStats | null,
  probeStatus: RegistryProbeStatus
): RegistryEndpointRow["runtimeStatus"] {
  if (telemetry?.last_at) return telemetry.last_ok ? "ok" : "error";
  if (!configured) return "unconfigured";
  if (probeStatus === "unknown") return "unknown";
  if (probeStatus === "ok") return "idle";
  return "idle";
}

function loadCodebasePaths(): Map<string, { provider: string; files: string[] }> {
  const map = new Map<string, { provider: string; files: string[] }>();
  const add = (provider: string, path: string, files: readonly string[]) => {
    const key = `${provider}|${path}`;
    const prev = map.get(key);
    if (prev) {
      const merged = new Set([...prev.files, ...files]);
      map.set(key, { provider, files: Array.from(merged) });
    } else {
      map.set(key, { provider, files: [...files] });
    }
  };

  for (const row of CURSOR_API_ANALYSIS.external.polygon) {
    add("polygon", row.path, row.files);
  }
  for (const row of CURSOR_API_ANALYSIS.external.unusual_whales) {
    add("unusual_whales", row.path, row.files);
  }
  for (const row of CURSOR_API_ANALYSIS.external.finnhub) {
    add("finnhub", row.path, row.files);
  }
  for (const row of CURSOR_API_ANALYSIS.external.anthropic) {
    add("anthropic", row.path, row.files);
  }
  for (const row of CURSOR_API_ANALYSIS.external.engine) {
    add("blackout_engine", row.path, row.files);
  }
  for (const row of CURSOR_API_ANALYSIS.external.web_search) {
    add("web_search", row.path, row.files);
  }
  return map;
}

function findCodeFiles(
  pathTemplate: string,
  providerId: string,
  codebase: Map<string, { provider: string; files: string[] }>
): string[] {
  const files = new Set<string>();
  for (const [key, val] of Array.from(codebase.entries())) {
    if (val.provider !== providerId) continue;
    const pathPart = key.split("|")[1] ?? "";
    if (pathsMatch(pathPart, pathTemplate)) {
      val.files.forEach((f) => files.add(f));
    }
  }
  return Array.from(files);
}

/** Reload analysis timestamp from disk (fresh after rescan without restart). */
export function readCodebaseScannedAt(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "src/lib/cursor-api-analysis-data.ts"), "utf8");
    const m = raw.match(/"generatedAt":\s*"([^"]+)"/);
    return m?.[1] ?? CURSOR_API_ANALYSIS.generatedAt;
  } catch {
    return CURSOR_API_ANALYSIS.generatedAt;
  }
}

export function buildEndpointRegistry(windowMs = 5 * 60_000): EndpointRegistryPayload {
  const telemetry = getApiTelemetrySnapshot(windowMs);
  const codebase = loadCodebasePaths();
  const probedAt = DOCS_PROBE_REPORT.summary.probedAt ?? null;

  const allTelemetryStats = Object.values(telemetry.by_provider).flatMap((p) => p.endpoints);
  const rows: RegistryEndpointRow[] = [];
  const seenPaths = new Set<string>();

  for (const doc of DOCS_PROBE_REPORT.results) {
    const { id: providerId, label: providerLabel, telemetryId } = mapDocProvider(doc.provider);
    const configured = isProviderConfigured(providerId);
    const catalog = findCatalogMeta(doc.pathTemplate, providerId);
    const tel = findTelemetry(doc.pathTemplate, telemetryId, allTelemetryStats);
    const sourceFiles = findCodeFiles(doc.pathTemplate, providerId, codebase);
    const probeStatus = probeToStatus(doc.probe);
    const pathKey = `${providerId}|${doc.pathTemplate}`;

    seenPaths.add(pathKey);
    rows.push({
      id: pathKey,
      provider: providerId,
      providerLabel,
      section: doc.docSection,
      name: doc.name,
      path: doc.resolvedPath ?? doc.pathTemplate,
      pathTemplate: doc.pathTemplate,
      documented: true,
      usedInCode: doc.usedInCode,
      sourceFiles: sourceFiles.length ? sourceFiles : doc.usedInCode ? ["(matched via template)"] : [],
      catalogUsedBy: catalog?.used_by ?? [],
      catalogDescription: catalog?.description ?? null,
      probeStatus,
      probeHttp: doc.probe.status ?? null,
      probeMs: doc.probe.ms ?? null,
      probeNote: doc.probe.note ?? null,
      probeBlocked: doc.probe.blocked ?? false,
      telemetry: tel,
      runtimeStatus: runtimeStatus(configured, tel, probeStatus),
      integrationCandidate: !doc.usedInCode && doc.probe.ok,
      productionRisk:
        doc.usedInCode &&
        (doc.probe.blocked || (!doc.probe.ok && Number(doc.probe.status) !== 429)),
    });
  }

  const codeOnlyPaths: EndpointRegistryPayload["codeOnlyPaths"] = [];
  for (const [key, val] of Array.from(codebase.entries())) {
    const path = key.split("|")[1] ?? "";
    const pathKey = `${val.provider}|${path}`;
    if (seenPaths.has(pathKey)) continue;
    const already = rows.some((r) => r.provider === val.provider && pathsMatch(r.pathTemplate, path));
    if (already) continue;

    seenPaths.add(pathKey);
    codeOnlyPaths.push({ provider: val.provider, path, files: val.files });

    const telemetryId = val.provider as ApiProviderId;
    const tel = findTelemetry(path, telemetryId, allTelemetryStats);
    const catalog = findCatalogMeta(path, val.provider);

    rows.push({
      id: pathKey,
      provider: val.provider,
      providerLabel: val.provider.replace(/_/g, " "),
      section: "Codebase only",
      name: path.split("/").pop() ?? path,
      path,
      pathTemplate: path,
      documented: false,
      usedInCode: true,
      sourceFiles: val.files,
      catalogUsedBy: catalog?.used_by ?? [],
      catalogDescription: catalog?.description ?? null,
      probeStatus: "unknown",
      probeHttp: null,
      probeMs: null,
      probeNote: "Not in docs catalog — add to polygon/uw docs or run probe:docs",
      probeBlocked: false,
      telemetry: tel,
      runtimeStatus: runtimeStatus(isProviderConfigured(val.provider), tel, "unknown"),
      integrationCandidate: false,
      productionRisk: false,
    });
  }

  rows.sort((a, b) => {
    const pc = a.provider.localeCompare(b.provider);
    if (pc !== 0) return pc;
    if (a.usedInCode !== b.usedInCode) return a.usedInCode ? -1 : 1;
    return a.pathTemplate.localeCompare(b.pathTemplate);
  });

  const providerMap = new Map<string, RegistryProviderHealth>();
  for (const row of rows) {
    const prev = providerMap.get(row.provider) ?? {
      id: row.provider,
      name: row.providerLabel,
      configured: isProviderConfigured(row.provider),
      documentedTotal: 0,
      usedTotal: 0,
      unusedTotal: 0,
      probeOk: 0,
      probeFail: 0,
      telemetryCalls: 0,
      telemetryErrors: 0,
    };
    if (row.documented) prev.documentedTotal += 1;
    if (row.usedInCode) prev.usedTotal += 1;
    else prev.unusedTotal += 1;
    if (row.probeStatus === "ok") prev.probeOk += 1;
    if (row.probeStatus === "fail" || row.probeStatus === "blocked") prev.probeFail += 1;
    providerMap.set(row.provider, prev);
  }

  for (const [id, tel] of Object.entries(telemetry.by_provider)) {
    const p = providerMap.get(id);
    if (p) {
      p.telemetryCalls = tel.calls;
      p.telemetryErrors = tel.errors;
    }
  }

  const documentedTotal = rows.filter((r) => r.documented).length;
  const usedInCode = rows.filter((r) => r.usedInCode).length;

  return {
    generated_at: new Date().toISOString(),
    codebase_scanned_at: readCodebaseScannedAt(),
    probe_completed_at: probedAt,
    summary: {
      documented_total: documentedTotal,
      used_in_code: usedInCode,
      unused_in_code: rows.filter((r) => !r.usedInCode).length,
      integration_candidates: rows.filter((r) => r.integrationCandidate).length,
      production_risks: rows.filter((r) => r.productionRisk).length,
      probe_ok: rows.filter((r) => r.probeStatus === "ok").length,
      probe_fail: rows.filter((r) => r.probeStatus === "fail").length,
      probe_blocked: rows.filter((r) => r.probeStatus === "blocked").length,
      internal_routes: CURSOR_API_ANALYSIS.internalRoutes.length,
      code_only_paths: codeOnlyPaths.length,
      runtime_calls_window: telemetry.totals.calls,
      runtime_errors_window: telemetry.totals.errors,
      window_label: `${Math.round(windowMs / 60_000)}m`,
    },
    providers: Array.from(providerMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    endpoints: rows,
    internalRoutes: CURSOR_API_ANALYSIS.internalRoutes.map((r) => ({ ...r })),
    codeOnlyPaths,
  };
}
