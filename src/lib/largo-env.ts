import { isStagingDeploy } from "@/lib/clerk-env";

/**
 * Client-safe gate for Largo desk surfaces (SPX commentary rail polling).
 * Staging runs BIE-only; production commentary also composes via BIE server-side.
 *
 * Do NOT import `@/lib/ai-env` here — it transitively imports anthropic telemetry
 * (`server-only`) and breaks `next build` when bundled into client components.
 */
export function largoEnabled(): boolean {
  // Staging: BIE commentary rail must always poll.
  if (isStagingDeploy()) return true;
  // Production: client enables rail; API enforces auth + generation server-side.
  return true;
}
