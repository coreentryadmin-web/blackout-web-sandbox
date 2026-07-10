/**
 * AI spend policy — staging defaults to BIE-only (zero Anthropic).
 * Set STAGING_CLAUDE=1 to opt back into Claude on staging for A/B tests.
 */
import { isStagingDeploy } from "@/lib/clerk-env";
import { anthropicConfigured } from "@/lib/providers/anthropic";

/** True when Anthropic calls are allowed in this deploy. */
export function claudeEnabled(): boolean {
  if (process.env.STAGING_CLAUDE === "1") return anthropicConfigured();
  if (isStagingDeploy()) return false;
  return anthropicConfigured();
}

/** Largo terminal is available when Claude is on OR staging BIE mode is active. */
export function largoAvailable(): boolean {
  return claudeEnabled() || isStagingDeploy();
}
