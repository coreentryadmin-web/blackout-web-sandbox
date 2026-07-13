import { createElement, type ReactNode } from "react";

/**
 * Render `{{...}}` white-emphasis markup: the wrapped content renders in the `spx-ai-key` emphasis
 * span, the rest stays plain. The SPX desk brief wraps every number and every verbatim headline in
 * `{{ }}` (see `spx-desk-brief.ts` `n()`), so ANY surface that shows those strings MUST run them
 * through this stripper — otherwise the member sees the literal marker (e.g. `γflip {{7,543}}`).
 *
 * Extracted to a shared util (was a local fn in SpxCommentaryRail) so every render site strips
 * identically: the commentary headline/body AND its Changed/Watch lists, plus the play terminal
 * line. A site that renders a desk-brief string raw is a latent leak; funnelling them all here means
 * a new `{{ }}`-bearing field can never re-introduce the bug at one forgotten call site.
 */
export function renderEmphasis(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{\{([^}]*)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    // createElement (not JSX) so the helper is JSX-runtime-agnostic — it renders identically under
    // Next's automatic runtime and under the test runner's classic transform.
    out.push(createElement("span", { key: k++, className: "spx-ai-key" }, m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
