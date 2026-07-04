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
  updateBieKnowledgeEmbeddings,
  type BieKnowledgeRow,
} from "@/lib/db";
import { bieEmbeddingsConfigured, chunkDocument, cosine, embedTexts } from "./embeddings";

const hashOf = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 40);

export type KnowledgeKind = "doc" | "finding" | "edition" | "zerodte_recap" | "self_eval" | "precedent";

type ChunkRef = { chunk: string; chunk_hash: string };

/** Split chunks into what needs INSERTING (never seen) vs what needs its
 *  embedding BACKFILLED (stored cold before the key existed). Pure + tested —
 *  this partition is what makes "add the key later" actually work: without the
 *  cold set, hash-dedup would skip un-embedded chunks forever. */
export function partitionForEmbedding(
  all: ChunkRef[],
  existing: Map<string, boolean>,
  embeddingsOn: boolean
): { fresh: ChunkRef[]; cold: ChunkRef[] } {
  return {
    fresh: all.filter((c) => !existing.has(c.chunk_hash)),
    cold: embeddingsOn ? all.filter((c) => existing.get(c.chunk_hash) === false) : [],
  };
}

/** Store chunks (hash-deduped); embed when configured, store cold otherwise.
 *  Chunks stored cold in a previous run are backfilled once a key lands. */
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
  // cron never re-pays the embeddings provider for the same EMBEDDED chunk
  // twice. Cold chunks are the exception: they get one embed to backfill.
  const existing = await fetchExistingBieHashes(all.map((c) => c.chunk_hash)).catch(
    () => new Map<string, boolean>()
  );
  const { fresh, cold } = partitionForEmbedding(all, existing, bieEmbeddingsConfigured());
  if (fresh.length === 0 && cold.length === 0) return 0;
  let embeddings: (number[] | null)[] = fresh.map(() => null);
  let coldEmbeddings: number[][] = [];
  if (bieEmbeddingsConfigured()) {
    try {
      // One provider call for both sets — fresh first, then backfills.
      const embedded = await embedTexts([...fresh, ...cold].map((c) => c.chunk), "document");
      embeddings = embedded.slice(0, fresh.length);
      coldEmbeddings = embedded.slice(fresh.length);
    } catch {
      // Store cold — the next ingest retries the backfill; never lose
      // knowledge over an embed hiccup.
      embeddings = fresh.map(() => null);
      coldEmbeddings = [];
    }
  }
  let written = 0;
  if (fresh.length > 0) {
    written += await insertBieKnowledge(
      fresh.map((c, i) => ({
        kind,
        source,
        chunk: c.chunk,
        chunk_hash: c.chunk_hash,
        embedding: embeddings[i] ?? null,
      }))
    );
  }
  if (coldEmbeddings.length > 0) {
    written += await updateBieKnowledgeEmbeddings(
      cold.map((c, i) => ({ chunk_hash: c.chunk_hash, embedding: coldEmbeddings[i]! }))
    );
  }
  return written;
}

export type RetrievedChunk = { source: string; kind: string; chunk: string; similarity: number };

/** Top-k knowledge for a question — embeds the query, ranks stored chunks by
 *  cosine in Node (corpus is thousands of chunks, not millions). Returns [] when
 *  embeddings aren't configured or nothing clears the similarity floor. */
// Evidence-calibrated 2026-07-03 (docs/audit/FINDINGS.md — BIE retrieval-floor
// entry): 4 representative questions against the live voyage-3 corpus returned
// correct top-1 matches at 0.348-0.562 similarity and correct top-3 matches
// down to 0.256 — the prior 0.55 floor (an untested guess predating any real
// embeddings) passed only 1 of 12 genuinely relevant hits. 0.30 keeps every
// top-1 match and 10 of 12 total hits from that evidence set while still
// excluding pure noise. Re-derive from a fresh probe set before moving it again.
// (Inherited as the starting default for the "precedent" kind too — that
// corpus is short templated descriptions, not prose, and hasn't had its own
// evidence pass yet; re-derive once real precedent queries accumulate.)
export const DEFAULT_MIN_SIMILARITY = 0.3;

/** `kind` optionally scopes retrieval to one knowledge kind (e.g. "precedent")
 *  instead of ranking across the whole corpus — same embed-and-cosine-rank
 *  logic either way, just a narrower candidate set from fetchBieKnowledge. */
export async function searchKnowledge(
  query: string,
  k = 3,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  kind?: KnowledgeKind
): Promise<RetrievedChunk[]> {
  if (!dbConfigured() || !bieEmbeddingsConfigured()) return [];
  try {
    const [qEmb] = await embedTexts([query], "query");
    if (!qEmb) return [];
    const rows = await fetchBieKnowledge({ limit: 800, kind });
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

/** Hand-maintained on purpose — "is this stage done, is autonomy authorized" is
 *  a judgment call, not a fact grep can extract. Kept small and in one place
 *  (not buried in ARCHITECTURE.md prose) specifically so it stays cheap to
 *  audit and update the moment a stage's status actually changes. */
const BIE_STAGE_STATUS: { stage: string; status: string }[] = [
  { stage: "Stage 1 — docs/knowledge ingestion, API usage telemetry", status: "SHIPPED" },
  { stage: "Stage 2 — logs, errors, cron/worker health, duplicate/missed-alert detection", status: "SHIPPED (zero new credentials — reads tables the app already writes)" },
  { stage: "Stage 3 — Railway/Postgres/Redis/Clerk-auth infra access", status: "SHIPPED" },
  { stage: "Stage 4 — unified alert_audit_log across 0DTE + Night Hawk (published + rejected)", status: "SHIPPED" },
  { stage: "Stage 5 step 1 — dry-run orphaned-component text proposals", status: "SHIPPED, deliberately narrow: never writes a file, never runs git, never opens a PR. Stage 5's actual end state (BIE opening its own PRs) is NOT built and NOT authorized." },
  { stage: "Stage 6 — using outcome data to calibrate live scoring", status: "NOT STARTED, NOT AUTHORIZED. Every precursor measurement (e.g. confluence outcomes) is read-only and reports numbers; none of it acts on them." },
];

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

  // BIE self-knowledge (generated, not hand-typed): the tool/field inventory
  // read straight from the source of truth (tool-defs.ts, ecosystem-context.ts)
  // instead of prose that has to be remembered and kept in sync by hand. This is
  // the fix for the 2026-07-04 incident where docs/bie/ARCHITECTURE.md described
  // only the very first BIE PR and Largo repeated that stale answer to a member
  // (docs/audit/FINDINGS.md) — the tool/field list can no longer drift out of
  // date because it is regenerated from real exports on every ingest, not edited
  // by a human who has to remember to. Stage rollout status is still a judgment
  // call (is a stage "done," is autonomy authorized) and stays hand-maintained
  // below, deliberately small so drift here is cheap to notice and fix.
  try {
    const [{ LARGO_TOOL_DEFS, BIE_TOOL_NAMES }, { ECOSYSTEM_CONTEXT_FIELDS }] = await Promise.all([
      import("@/lib/largo/tool-defs"),
      import("./ecosystem-context"),
    ]);
    const bieTools = LARGO_TOOL_DEFS.filter((td) => (BIE_TOOL_NAMES as string[]).includes(td.name));
    const toolLines = bieTools.map((td) => `- ${td.name}: ${td.description}`).join("\n\n");
    const fieldLines = ECOSYSTEM_CONTEXT_FIELDS.map((f) => `- ${f.field}: ${f.description}`).join("\n");
    const stageLines = BIE_STAGE_STATUS.map((s) => `- ${s.stage}: ${s.status}`).join("\n");
    const text = [
      "BLACKOUT Intelligence Engine — live capabilities (generated from source, not hand-typed).",
      `\nLargo tools BIE provides (${bieTools.length} today — count and descriptions read live from src/lib/largo/tool-defs.ts):\n${toolLines}`,
      `\nfetchEcosystemContext() fields — one ticker's cross-instrument snapshot:\n${fieldLines}`,
      `\nRollout stage status (hand-maintained — see docs/bie/FULL-SYSTEM-AWARENESS.md for full evidence):\n${stageLines}`,
    ].join("\n");
    stored += await storeKnowledge("doc", "platform:bie-capabilities", text);
  } catch {
    // registries unavailable in some contexts — skip, same fail-open as platform:map
  }

  // Semantic precedent search: every RESOLVED alert from the last 60 days
  // becomes one embedded "precedent" chunk (src/lib/bie/precedent-search.ts) —
  // dynamic import to avoid a knowledge.ts <-> precedent-search.ts import
  // cycle, same pattern as the tool-defs/ecosystem-context import above.
  try {
    const { ingestAlertPrecedents } = await import("./precedent-search");
    const { stored: precedentsStored } = await ingestAlertPrecedents(60);
    stored += precedentsStored;
  } catch {
    // db/embeddings unavailable in some contexts — skip, same fail-open as everything else here
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
