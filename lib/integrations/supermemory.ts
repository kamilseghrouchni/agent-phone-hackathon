// lib/integrations/supermemory.ts — official Supermemory SDK wrapper.
//
// Used by Chain-Ops voice-persona.ts at three call sites:
//   pre-call:  loadBuyerSpec(runId)   → profile({ containerTag, q: "buyer spec" })
//   per-turn:  retrieveForTurn(runId, question)
//   post-call: writeCallEvidence({ runId, supplierId, fieldId, quote, eventId })
//
// containerTag = runId so memories are scoped per procurement run.

import Supermemory from "supermemory";

let _client: Supermemory | null = null;

function getClient(): Supermemory {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey) throw new Error("SUPERMEMORY_API_KEY is not set");
  if (!_client) {
    _client = new Supermemory({
      apiKey,
      ...(process.env.SUPERMEMORY_API_BASE ? { baseURL: process.env.SUPERMEMORY_API_BASE } : {}),
    });
  }
  return _client;
}

export function supermemoryConfigured(): boolean {
  return Boolean(process.env.SUPERMEMORY_API_KEY);
}

// ---- types -----------------------------------------------------------------

export interface AddMemoryInput {
  /** Stable context bucket — typically the run_id so per-call retrieval is scoped. */
  contextId: string;
  /** Free-form text to remember. Verbatim is preferred for evidence provenance. */
  content: string;
  /** Optional metadata blob (echoed back on retrieval). */
  metadata?: Record<string, unknown>;
}

export interface AddMemoryResult {
  id: string;
  context_id: string;
  created_at: string;
}

export interface MemoryHit {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface ProfileResult {
  /** Static (long-term) profile facts. */
  static: string[];
  /** Dynamic (recent) profile context. */
  dynamic: string[];
  /** Relevant memory hits matching `q`. */
  hits: MemoryHit[];
  latency_ms: number;
}

// ---- public API ------------------------------------------------------------

/**
 * Persist a memory under a context bucket (containerTag = contextId).
 */
export async function add(input: AddMemoryInput): Promise<AddMemoryResult> {
  const client = getClient();
  const raw = (await client.add({
    content: input.content,
    containerTag: input.contextId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  } as Parameters<typeof client.add>[0])) as unknown as Record<string, unknown>;
  return {
    id: String(raw.id ?? raw.documentId ?? raw.memory_id ?? ""),
    context_id: input.contextId,
    created_at: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  };
}

/**
 * Retrieve a contextual profile (static + dynamic + relevant memory hits) for
 * a query. One round-trip — the voice agent's primary read path.
 */
export async function profile(args: {
  contextId: string;
  q: string;
  threshold?: number;
}): Promise<ProfileResult> {
  const started = Date.now();
  const client = getClient();
  const raw = (await client.profile({
    containerTag: args.contextId,
    q: args.q,
    ...(args.threshold ? { threshold: args.threshold } : {}),
  } as Parameters<typeof client.profile>[0])) as unknown as Record<string, unknown>;

  const rawProfile = (raw.profile ?? {}) as { static?: unknown; dynamic?: unknown };
  const rawSearch = (raw.searchResults ?? raw.search_results ?? {}) as { results?: unknown };
  const rawResults = Array.isArray(rawSearch.results) ? rawSearch.results : [];

  return {
    static: Array.isArray(rawProfile.static) ? (rawProfile.static as string[]) : [],
    dynamic: Array.isArray(rawProfile.dynamic) ? (rawProfile.dynamic as string[]) : [],
    hits: rawResults.map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ""),
      content: String(r.memory ?? r.content ?? r.text ?? ""),
      score: typeof r.score === "number" ? r.score : 0,
      metadata: (r.metadata as Record<string, unknown>) ?? undefined,
    })),
    latency_ms: Date.now() - started,
  };
}

/**
 * Convenience helpers for the voice-persona pipeline. Mirrors the three call
 * sites in spec §6 V7.1.
 */
export const supermemory = {
  add,
  profile,

  /** Pre-call: load buyer spec context for the agent's system prompt. */
  async loadBuyerSpec(runId: string): Promise<ProfileResult> {
    return profile({ contextId: runId, q: "buyer spec procurement NSCLC requirements" });
  },

  /** Per-turn: find context relevant to the agent's next question. */
  async retrieveForTurn(runId: string, question: string): Promise<ProfileResult> {
    return profile({ contextId: runId, q: question, threshold: 0.7 });
  },

  /** Post-call: write supplier-answer evidence keyed to (runId, supplierId, fieldId). */
  async writeCallEvidence(args: {
    runId: string;
    supplierId: string;
    fieldId: string;
    quote: string;
    eventId: string;
  }): Promise<AddMemoryResult> {
    return add({
      contextId: args.runId,
      content: `[${args.supplierId} · ${args.fieldId}] ${args.quote}`,
      metadata: {
        supplier_id: args.supplierId,
        field_id: args.fieldId,
        event_id: args.eventId,
        channel: "call",
      },
    });
  },

  // ----- cross-run supplier memory ----------------------------------------
  // The three helpers above scope by `runId` (per-procurement). The two
  // below scope by `supplierId` so memories persist ACROSS runs — every
  // chain that contacts crovi.bio adds to its profile, and the next chain
  // recalls that context before Stage 1 fires.
  // ------------------------------------------------------------------------

  /**
   * Pre-chain recall: pull what we already know about this supplier from
   * prior procurement runs. Returns up to 5 most-relevant memories +
   * static/dynamic profile. Demo surfaces hit count + top quotes in the
   * Timeline so the audience sees Supermemory fire.
   */
  async recallSupplierContext(
    supplierId: string,
    query?: string,
  ): Promise<ProfileResult> {
    return profile({
      contextId: `supplier:${supplierId}`,
      q:
        query ??
        `prior procurement interactions outcomes pricing capacity ${supplierId}`,
      threshold: 0.6,
    });
  },

  /**
   * Post-chain write: persist a summary of THIS run's outcomes against
   * this supplier so future chains can recall them. Stored under
   * `supplier:<id>` containerTag, distinct from the per-run scope.
   */
  async writeChainCompletion(args: {
    supplierId: string;
    runId: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<AddMemoryResult> {
    return add({
      contextId: `supplier:${args.supplierId}`,
      content: `[run ${args.runId}] ${args.summary}`,
      metadata: {
        supplier_id: args.supplierId,
        run_id: args.runId,
        kind: "chain_completion",
        ...args.metadata,
      },
    });
  },
};

export default supermemory;
