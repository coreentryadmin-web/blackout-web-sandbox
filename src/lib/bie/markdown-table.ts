/** Markdown table helper for BIE dynamic answers. */

export function markdownTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return "";
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const sep = headers.map(() => "---");
  const lines = [
    `| ${headers.map(esc).join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.map((r) => `| ${r.map((c) => esc(String(c))).join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function markdownBullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}
