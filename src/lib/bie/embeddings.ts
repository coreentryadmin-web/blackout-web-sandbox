// BLACKOUT Intelligence Engine — Layer 2 embeddings client (Voyage AI).
// Env-gated: without VOYAGE_API_KEY every caller degrades cleanly (knowledge
// layer simply stays cold). voyage-3 is finance-strong and ~$0.06/M tokens.

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = process.env.VOYAGE_EMBED_MODEL?.trim() || "voyage-3";

export function bieEmbeddingsConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY?.trim());
}

/** Embed up to 128 texts (Voyage batch cap). Throws on hard API failure —
 *  callers decide whether to fail soft. */
export async function embedTexts(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) throw new Error("VOYAGE_API_KEY not configured");
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const batch = texts.slice(i, i + 128).map((t) => t.slice(0, 8000));
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: batch, input_type: inputType }),
    });
    if (!res.ok) throw new Error(`voyage embeddings ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    for (const row of json.data ?? []) {
      if (!Array.isArray(row.embedding)) throw new Error("voyage embeddings: malformed row");
      out.push(row.embedding);
    }
  }
  if (out.length !== texts.length) throw new Error("voyage embeddings: count mismatch");
  return out;
}

/** Cosine similarity — pure, used by retrieval ranking. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Split a document into overlapping chunks that embed well (~1200 chars on
 *  paragraph boundaries). Pure + tested. */
export function chunkDocument(text: string, maxLen = 1200): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxLen) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    // Hard-split any single paragraph longer than the cap.
    while (cur.length > maxLen) {
      chunks.push(cur.slice(0, maxLen));
      cur = cur.slice(maxLen - 150); // 150-char overlap keeps context stitched
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
