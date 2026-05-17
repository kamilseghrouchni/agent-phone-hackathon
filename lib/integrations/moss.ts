// lib/integrations/moss.ts — Moss (YC F25) real-time semantic search.
//
// Moss complements Supermemory:
//   - Supermemory  = long-term buyer-spec context ("what does NovaCure want
//                    across the whole procurement run")
//   - Moss         = fast tactical retrieval scoped to THIS turn's question
//                    (sub-200ms p99 target — that's their pitch)
//
// SDK: `@moss-dev/moss` exposes a single MossClient class:
//   const c = new MossClient(projectId, projectKey)
//   await c.createIndex(indexName, docs)   // server-side build
//   await c.loadIndex(indexName)           // pull into memory for fast query
//   await c.query(indexName, q, { topK })  // SearchResult { docs: [{id,text,score}] }
//
// We use ONE index per run (indexName = `run:<runId>`) so each procurement
// run carries its own 35-field corpus + any other tactical snippets we
// want to surface mid-call.

import { MossClient, type DocumentInfo } from "@moss-dev/moss";

let _client: MossClient | null = null;
const _loadedIndexes = new Set<string>();

function getClient(): MossClient {
  const projectId = process.env.MOSS_PROJECT_ID;
  const projectKey = process.env.MOSS_API_KEY;
  if (!projectId || !projectKey) {
    throw new Error(
      "MOSS_PROJECT_ID or MOSS_API_KEY missing. Set both in .env.local.",
    );
  }
  if (!_client) {
    _client = new MossClient(projectId, projectKey);
  }
  return _client;
}

/**
 * Pull the index into memory for fast local queries. Cached so subsequent
 * calls are no-ops. Moss's cloud `/query` endpoint is the slow path (and
 * unreliable in early access); loadIndex enables ~1-10ms in-memory matches
 * which is what the <200ms latency promise depends on.
 */
async function ensureLoaded(indexName: string): Promise<void> {
  if (_loadedIndexes.has(indexName)) return;
  const client = getClient();
  await client.loadIndex(indexName);
  _loadedIndexes.add(indexName);
}

export function mossConfigured(): boolean {
  return Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_API_KEY);
}

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export interface MossHit {
  id: string;
  content: string;
  score: number;
}

export interface MossSearchInput {
  /** Per-run index name. Defaults to a shared "demo" index. */
  indexName?: string;
  query: string;
  k?: number;
}

export interface MossSeedInput {
  /** Per-run index name. */
  indexName: string;
  /** Documents to index. Each `id` should be a stable handle (e.g. field_id). */
  docs: Array<{ id: string; text: string }>;
}

// ───────────────────────────────────────────────────────────────────────────
// Budget — Moss promises <200ms p99 cloud query latency; we hard-cap at 1s
// so a degraded network never blocks a voice turn.
// ───────────────────────────────────────────────────────────────────────────

const QUERY_TIMEOUT_MS = 1_000;

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${tag} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build (or rebuild) an index for a run. Idempotent-ish: if the index
 * already exists, we fall back to `addDocs(upsert: true)` so re-seeding
 * the same run doesn't crash.
 */
export async function mossSeed(input: MossSeedInput): Promise<{ jobId?: string; mode: "real" | "missing_env" | "fallback" }> {
  if (!mossConfigured()) {
    return { mode: "missing_env" };
  }
  if (input.docs.length === 0) return { mode: "real" };

  const client = getClient();
  const docs: DocumentInfo[] = input.docs.map((d) => ({ id: d.id, text: d.text }));

  try {
    const res = await client.createIndex(input.indexName, docs);
    // Pre-load so the first query is fast.
    await ensureLoaded(input.indexName).catch(() => undefined);
    return { jobId: res.jobId, mode: "real" };
  } catch (err) {
    // Index probably already exists. Try the upsert path so the corpus
    // stays fresh across rehearsals without manual deleteIndex().
    try {
      const res = await client.addDocs(input.indexName, docs, { upsert: true });
      _loadedIndexes.delete(input.indexName); // force reload after mutation
      await ensureLoaded(input.indexName).catch(() => undefined);
      return { jobId: res.jobId, mode: "fallback" };
    } catch {
      throw err;
    }
  }
}

/**
 * Run a semantic search and return at most `k` hits. Resolves to an empty
 * array on timeout / missing env / non-existent index so callers can fall
 * through to Supermemory without try/catch noise at every site.
 */
export async function mossSearch(input: MossSearchInput): Promise<MossHit[]> {
  if (!mossConfigured()) return [];

  const indexName = input.indexName ?? "demo";
  const k = input.k ?? 3;
  try {
    const client = getClient();
    // Ensure the index is in memory — required for the <200ms target since
    // Moss's cloud `/query` fallback is slow (and sometimes 503s in F25).
    await ensureLoaded(indexName);
    const result = await withTimeout(
      client.query(indexName, input.query, { topK: k }),
      QUERY_TIMEOUT_MS,
      `moss.query ${indexName}`,
    );
    const raw = result as unknown as { docs?: Array<Record<string, unknown>> };
    const docs = raw.docs ?? [];
    return docs.map((d) => ({
      id: String(d.id ?? ""),
      content: String(d.text ?? d.content ?? ""),
      score: typeof d.score === "number" ? (d.score as number) : 0,
    }));
  } catch {
    return [];
  }
}

/** Per-run index name convention. Keeps each run's corpus isolated. */
export function mossIndexName(runId: string): string {
  // Moss index names are constrained; strip non-alnum and prefix.
  const safe = runId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 32);
  return `run-${safe}`;
}
