import { largoAvailable } from "@/lib/ai-env";

/**
 * Largo desk surfaces (SPX commentary rail, terminal API).
 * Production: Claude when configured. Staging: BIE-only (zero Anthropic) — see ai-env.
 */
export function largoEnabled(): boolean {
  return largoAvailable();
}
