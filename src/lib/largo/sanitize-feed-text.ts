/**
 * Pure, alias-free sanitizer for untrusted external free-text (news titles/teasers,
 * web-search snippets, headlines) before it enters trusted contexts — either the
 * Largo system prompt or tool_result content returned to the model.
 *
 * It strips line breaks, code fences (backticks) and angle brackets so a crafted
 * headline/snippet cannot pose as instructions or open a fake markup/role block,
 * then collapses runs of whitespace and trims (LARGO-6 / prompt-injection hardening).
 *
 * Kept dependency-free and side-effect-free so it is trivially unit-testable
 * (tsx --test, relative import — no @/ alias needed).
 */
export function sanitizeFeedText(s: unknown): string {
  return String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[`<>]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
