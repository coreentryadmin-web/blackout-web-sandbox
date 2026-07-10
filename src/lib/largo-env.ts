import { isStagingDeploy } from "@/lib/clerk-env";

/**
 * Largo desk AI (terminal chat + SPX commentary rail) is production-only.
 * Staging validates playbooks, matrix, and engine paths without Anthropic spend.
 */
export function largoEnabled(): boolean {
  return !isStagingDeploy();
}
