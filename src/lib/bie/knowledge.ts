// BLACKOUT Intelligence Engine — Layer 2 knowledge store + retrieval.
// Everything the desk learns becomes a searchable chunk: playbooks and docs,
// audit findings, Night Hawk editions and outcomes, 0DTE session recaps, daily
// self-eval reports. Embeddings are env-gated (VOYAGE_API_KEY): without the key
// chunks are stored un-embedded and retrieval stays cold — the platform never
// degrades because a key is missing; it just gets smarter the moment one lands.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  dbConfigured,
  fetchBieKnowledge,
  fetchExistingBieHashes,
  fetchLatestNighthawkEdition,
  insertBieKnowledge,
  type BieKnowledgeRow,
} from "@/lib/db";
import { bieEmbeddingsConfigured, chunkDocument, cosine, embedTexts } from "./embeddings";

const hashOf = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 40);

export type KnowledgeKind = "doc" | "finding" | "edition" | "zerodte_recap" | "self_eval";

/** Store chunks (hash-deduped); embed when configured, store cold otherwise. */
export async function storeKnowledge(
  kind: KnowledgeKind,
  source: string,
  text: string
): Promise<number> {
  if (!dbConfigured() || !text.trim()) return 0;
  const all = chunkDocument(text).map((chunk) => ({
    chunk,
    chunk_hash: hashOf(`${kind}|${source}|${chunk}`),
  }));
  if (all.length === 0) return 0;
  // Dedup BEFORE embedding: unchanged content re-ingests for free — the daily
  // cron never re-pays the embeddings provider for the same chunk twice.
  const existing = await fetchExistingBieHashes(all.map((c) => c.chunk_hash)).catch(() => new Set<string>());
  const fresh = all.filter((c) => !existing.has(c.chunk_hash));
  if (fresh.length === 0) return 0;
  let embeddings: (number[] | null)[] = fresh.map(() => null);
  if (bieEmbeddingsConfigured()) {
    try {
      embeddings = await embedTexts(fresh.map((c) => c.chunk), "document");
    } catch {
      // Store cold — a later ingest can backfill; never lose knowledge over an
      // embed hiccup.
      embeddings = fresh.map(() => null);
    }
  }
  return insertBieKnowledge(
    fresh.map((c, i) => ({
      kind,
      source,
      chunk: c.chunk,
      chunk_hash: c.chunk_hash,
      embedding: embeddings[i] ?? null,
    }))
  );
}

export type RetrievedChunk = { source: string; kind: string; chunk: string; similarity: number };

/** Top-k knowledge for a question — embeds the query, ranks stored chunks by
 *  cosine in Node (corpus is thousands of chunks, not millions). Returns [] when
 *  embeddings aren't configured or nothing clears the similarity floor. */
export async function searchKnowledge(query: string, k = 3, minSimilarity = 0.55): Promise<RetrievedChunk[]> {
  if (!dbConfigured() || !bieEmbeddingsConfigured()) return [];
  try {
    const [qEmb] = await embedTexts([query], "query");
    if (!qEmb) return [];
    const rows = await fetchBieKnowledge({ limit: 800 });
    const scored = rows
      .filter((r): r is BieKnowledgeRow & { embedding: number[] } => Array.isArray(r.embedding))
      .map((r) => ({ source: r.source, kind: r.kind, chunk: r.chunk, similarity: cosine(qEmb, r.embedding) }))
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  } catch {
    return [];
  }
}

// ── Ingestion (daily, from the db-cleanup cron) ──────────────────────────────────

const DOC_DIRS = ["docs", "docs/bie", "docs/audit"];
const ROOT_DOCS = ["AGENTS.md", "CLAUDE.md"];

/** Ingest the platform's own knowledge: docs, findings, the latest Night Hawk
 *  edition recap. Hash-dedup makes this idempotent — unchanged content is free. */
export async function ingestBieKnowledge(): Promise<{ stored: number }> {
  if (!dbConfigured()) return { stored: 0 };
  let stored = 0;

  // Markdown docs (platform + audit knowledge).
  const files: string[] = [];
  for (const dir of DOC_DIRS) {
    try {
      for (const name of readdirSync(join(process.cwd(), dir))) {
        if (name.endsWith(".md")) files.push(join(dir, name));
      }
    } catch {
      // missing dir in some deploys — fine
    }
  }
  for (const name of ROOT_DOCS) files.push(name);
  for (const rel of files.slice(0, 40)) {
    try {
      // Read-then-bound (no stat-then-read TOCTOU): oversized docs are skipped
      // after the read. These are the repo's OWN markdown docs — a fixed,
      // deploy-time allowlist, never user input — and sending their content to
      // the configured embeddings provider is the documented purpose of this
      // function (docs/bie/ARCHITECTURE.md, Layer 2).
      const text = readFileSync(join(process.cwd(), rel), "utf8");
      if (text.length > 400_000) continue;
      stored += await storeKnowledge(rel.includes("audit") ? "finding" : "doc", rel, text);
    } catch {
      // unreadable file — skip
    }
  }

  // Platform self-knowledge (Phase 4 groundwork): a generated map of the desk's
  // own tools and crons, so BIE can answer questions about the platform itself.
  try {
    const [{ TOOLS }, { CRON_JOBS }] = await Promise.all([
      import("@/lib/tool-access"),
      import("@/lib/cron-registry"),
    ]);
    const toolLines = TOOLS.map((t) => `- ${t.label} (${t.key}) at ${t.href}`).join("\n");
    const cronLines = CRON_JOBS.map(
      (c) => `- ${c.name} (${c.key}): ${c.schedule_label} — ${c.description}`
    ).join("\n");
    const text = `BLACKOUT platform map (generated).\n\nMember tools:\n${toolLines}\n\nScheduled jobs:\n${cronLines}`;
    stored += await storeKnowledge("doc", "platform:map", text);
  } catch {
    // registries unavailable in some contexts — skip
  }

  // Latest Night Hawk edition — recap + play theses become searchable history.
  try {
    const edition = await fetchLatestNighthawkEdition();
    if (edition) {
      const plays = (Array.isArray(edition.plays) ? edition.plays : [])
        .map((p) => {
          const o = p as Record<string, unknown>;
          return `${o.ticker ?? "?"} ${o.direction ?? ""}: ${o.thesis ?? o.headline ?? ""}`.trim();
        })
        .filter((s) => s.length > 5)
        .join("\n");
      const text = [
        `Night Hawk edition for ${edition.edition_for}.`,
        edition.recap_headline ?? "",
        edition.recap_summary ?? "",
        plays,
      ]
        .filter(Boolean)
        .join("\n\n");
      stored += await storeKnowledge("edition", `nighthawk:${edition.edition_for}`, text);
    }
  } catch {
    // best-effort
  }

  return { stored };
}
