/**
 * Night Hawk diagnostics — comprehensive troubleshooting trail at every layer.
 * Tracks data sourcing attempts, fallback chain progress, and gate rejections
 * so every 0-play outcome is self-diagnosing.
 */

export type DataSourceAttempt = {
  source: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  duration_ms?: number;
};

export type DiagnosticTrail = {
  ticker: string;
  stage: string;
  timestamp: string;
  attempts: DataSourceAttempt[];
  final_value?: unknown;
  issue?: string;
};

export type NighthawkDiagnostics = {
  edition_date: string;
  candidates: number;
  dossiers_fetched: number;
  plays_generated: number;
  gates_applied: number;
  rejection_summary: {
    [key: string]: number; // gate name → rejection count
  };
  data_sourcing_trails: DiagnosticTrail[];
  gate_rejection_details: Array<{
    ticker: string;
    gate: string;
    reason: string;
    evidence?: string;
  }>;
};

class DiagnosticsCollector {
  private trails: DiagnosticTrail[] = [];
  private gateRejections: Array<{
    ticker: string;
    gate: string;
    reason: string;
    evidence?: string;
  }> = [];
  private rejectionCounts: { [key: string]: number } = {};

  recordDataSourceing(
    ticker: string,
    stage: string,
    attempts: DataSourceAttempt[],
    finalValue?: unknown,
    issue?: string
  ): void {
    this.trails.push({
      ticker,
      stage,
      timestamp: new Date().toISOString(),
      attempts,
      final_value: finalValue,
      issue,
    });
  }

  recordGateRejection(ticker: string, gate: string, reason: string, evidence?: string): void {
    this.gateRejections.push({ ticker, gate, reason, evidence });
    this.rejectionCounts[gate] = (this.rejectionCounts[gate] ?? 0) + 1;
  }

  summary(edition_date: string, candidates: number, dossiers: number, plays: number): NighthawkDiagnostics {
    return {
      edition_date,
      candidates,
      dossiers_fetched: dossiers,
      plays_generated: plays,
      gates_applied: Object.values(this.rejectionCounts).reduce((a, b) => a + b, 0),
      rejection_summary: this.rejectionCounts,
      data_sourcing_trails: this.trails,
      gate_rejection_details: this.gateRejections,
    };
  }
}

export const globalDiagnostics = new DiagnosticsCollector();

/**
 * Record a multi-step data sourcing attempt with detailed diagnostics.
 * Returns the first successful value or a detailed failure report.
 */
export async function withFallbacks<T>(
  ticker: string,
  stage: string,
  sources: Array<{
    name: string;
    fetch: () => Promise<T | null | undefined>;
  }>,
  options?: { required?: boolean }
): Promise<{ value: T | null; attempts: DataSourceAttempt[] }> {
  const attempts: DataSourceAttempt[] = [];

  for (const source of sources) {
    const start = Date.now();
    try {
      const value = await Promise.race([
        source.fetch(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000)
        ),
      ]);

      if (value != null) {
        attempts.push({
          source: source.name,
          ok: true,
          value,
          duration_ms: Date.now() - start,
        });
        globalDiagnostics.recordDataSourceing(ticker, stage, attempts, value);
        return { value, attempts };
      }

      attempts.push({
        source: source.name,
        ok: false,
        duration_ms: Date.now() - start,
      });
    } catch (err) {
      attempts.push({
        source: source.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      });
    }
  }

  const issue = options?.required
    ? `CRITICAL: All ${sources.length} sources failed for required field`
    : `All ${sources.length} sources exhausted`;

  globalDiagnostics.recordDataSourceing(ticker, stage, attempts, null, issue);
  return { value: null, attempts };
}

/**
 * Record multi-step data sourcing attempts with detailed diagnostics.
 */
export function recordDataSourceing(
  ticker: string,
  stage: string,
  attempts: DataSourceAttempt[],
  finalValue?: unknown,
  issue?: string
): void {
  globalDiagnostics.recordDataSourceing(ticker, stage, attempts, finalValue, issue);
}

/**
 * Log gate rejection with full evidence trail.
 */
export function recordGateReject(
  ticker: string,
  gate: string,
  reason: string,
  evidence: Record<string, unknown>
): void {
  globalDiagnostics.recordGateRejection(
    ticker,
    gate,
    reason,
    JSON.stringify(evidence, null, 2)
  );
  console.warn(`[nighthawk/${gate}] ${ticker}: ${reason}`, evidence);
}
