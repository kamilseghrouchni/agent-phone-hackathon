// lib/agents/browse-fallback.ts — cached snapshot fallback for Browser Use timeouts.
//
// Spec §6 V7.4. The 3 real Browser Use sessions (RefMed, Geneticist, Audubon)
// have a 45s hard timeout per session. If a session times out (or the iframe
// is killed), we transparently swap in a cached snapshot keyed by supplier_id.
// Audience never sees a broken iframe.
//
// Snapshot location: data/snapshots/{supplierId}.json
// Shape: free-form JSON the Enrich phase chose to cache for that supplier.
// Empty `{}` is a valid placeholder (means "no data, but file exists so
// loader returns success deterministically").

import fs from "fs";
import path from "path";

export const SUPPORTED_SUPPLIERS = ["refmed", "geneticist", "audubon"] as const;
export type SupplierId = (typeof SUPPORTED_SUPPLIERS)[number] | string;

export const BROWSE_TIMEOUT_MS = 45_000;

function snapshotsDir(): string {
  // process.cwd() in Next is the repo root.
  return path.join(process.cwd(), "data", "snapshots");
}

function snapshotPath(supplierId: string): string {
  return path.join(snapshotsDir(), `${supplierId}.json`);
}

export interface SnapshotResult<T = unknown> {
  supplier_id: string;
  source: "snapshot";
  loaded_at: string;
  is_empty: boolean;             // true when file is {} — UI can show "no cached fields"
  data: T;
}

export class SnapshotMissingError extends Error {
  constructor(public supplierId: string, public attemptedPath: string) {
    super(`No cached snapshot for supplier "${supplierId}" at ${attemptedPath}`);
    this.name = "SnapshotMissingError";
  }
}

/** Load the cached snapshot synchronously. Used by enrich.ts when Browser Use
 * times out. Throws SnapshotMissingError if the file isn't present. */
export function loadSnapshot<T = Record<string, unknown>>(supplierId: string): SnapshotResult<T> {
  const p = snapshotPath(supplierId);
  if (!fs.existsSync(p)) throw new SnapshotMissingError(supplierId, p);
  const raw = fs.readFileSync(p, "utf-8");
  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Snapshot at ${p} is not valid JSON: ${(err as Error).message}`);
  }
  const isEmpty =
    data === null ||
    (typeof data === "object" && data !== null && Object.keys(data as Record<string, unknown>).length === 0);
  return {
    supplier_id: supplierId,
    source: "snapshot",
    loaded_at: new Date().toISOString(),
    is_empty: isEmpty,
    data,
  };
}

/** True if a snapshot file exists. Cheap, sync, safe to call from React-server
 * components or chain runtime. */
export function hasSnapshot(supplierId: string): boolean {
  return fs.existsSync(snapshotPath(supplierId));
}

/** List all cached snapshot ids — useful for the debug pane. */
export function listSnapshots(): string[] {
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/**
 * Race a Browser Use scrape against the 45s timeout. If the scrape resolves
 * first, return it; otherwise transparently fall back to the cached snapshot.
 *
 * Usage:
 *   const result = await runWithSnapshotFallback("refmed", () => browserUse.scrape(...));
 *   if (result.source === "snapshot") flagFallbackInUI();
 */
export async function runWithSnapshotFallback<T>(
  supplierId: string,
  scrape: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<{ source: "live"; data: T } | SnapshotResult<unknown>> {
  const timeoutMs = opts.timeoutMs ?? BROWSE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<"__timeout__">((resolve) => {
    timer = setTimeout(() => resolve("__timeout__"), timeoutMs);
  });

  try {
    const winner = await Promise.race([scrape(), timeoutPromise]);
    if (winner === "__timeout__") {
      return loadSnapshot(supplierId);
    }
    return { source: "live", data: winner as T };
  } catch {
    // Live scrape failed — try snapshot before propagating.
    if (hasSnapshot(supplierId)) return loadSnapshot(supplierId);
    throw new SnapshotMissingError(supplierId, snapshotPath(supplierId));
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
