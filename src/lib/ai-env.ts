/**
 * AI spend policy — staging defaults to BIE-only (zero Anthropic) except Largo when opted in.
 * - STAGING_CLAUDE=1 — global Claude (commentary, flow-brief, etc.) for A/B tests.
 * - STAGING_LARGO_CLAUDE=1 — Claude for Largo terminal only; SPX commentary stays BIE.
 */
import { isStagingDeploy } from "@/lib/clerk-env";
import { anthropicConfigured } from "@/lib/providers/anthropic";

/** True when Anthropic calls are allowed in this deploy (all surfaces). */
export function claudeEnabled(): boolean {
  if (process.env.STAGING_CLAUDE === "1") return anthropicConfigured();
  if (isStagingDeploy()) return false;
  return anthropicConfigured();
}

/** Claude allowed for the Largo product only — does not enable SPX commentary / flow-brief LLM. */
export function largoClaudeEnabled(): boolean {
  if (process.env.LARGO_BIE_ONLY === "1") return false;
  if (!anthropicConfigured()) return false;
  if (isStagingDeploy()) {
    return process.env.STAGING_LARGO_CLAUDE === "1" || process.env.STAGING_CLAUDE === "1";
  }
  return true;
}

/** Skip deterministic BIE router — every Largo turn uses Claude + tools (staging default when Largo Claude is on). */
export function largoSkipBieRouter(): boolean {
  if (process.env.LARGO_BIE_ONLY === "1") return false;
  if (process.env.LARGO_BIE_FIRST === "1") return false;
  if (process.env.LARGO_CLAUDE_ONLY === "1") return true;
  if (isStagingDeploy() && process.env.STAGING_LARGO_CLAUDE === "1") return true;
  return false;
}

/** Largo terminal is available when Claude is on OR staging BIE mode is active. */
export function largoAvailable(): boolean {
  return largoClaudeEnabled() || isStagingDeploy();
}

/** Staging deploy with default BIE-only policy (STAGING_CLAUDE≠1 and STAGING_LARGO_CLAUDE≠1). */
export function isStagingBieMode(): boolean {
  return (
    isStagingDeploy() &&
    process.env.STAGING_CLAUDE !== "1" &&
    process.env.STAGING_LARGO_CLAUDE !== "1"
  );
}

/** Largo never calls Claude — staging default (without STAGING_LARGO_CLAUDE) or LARGO_BIE_ONLY=1. */
export function largoBieOnly(): boolean {
  if (process.env.LARGO_BIE_ONLY === "1") return true;
  if (largoClaudeEnabled()) return false;
  return isStagingDeploy() && process.env.STAGING_CLAUDE !== "1";
}
