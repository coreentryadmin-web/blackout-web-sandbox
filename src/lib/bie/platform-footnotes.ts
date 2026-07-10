import type { RetrievedChunk } from "@/lib/bie/knowledge";

/** Format retrieved knowledge as a deterministic footnote block (no LLM). */
export function formatKnowledgeFootnotes(chunks: RetrievedChunk[]): string | null {
  if (!chunks.length) return null;
  const lines = chunks.map((c) => `- _${c.kind}/${c.source}_: ${c.chunk.slice(0, 220).trim()}`);
  return ["**Desk knowledge**", ...lines].join("\n");
}
