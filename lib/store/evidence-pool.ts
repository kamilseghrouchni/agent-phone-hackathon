// Local stand-in for the Trunk-owned evidence pool writer (spec F4).
// Trunk will replace the implementation; the signature `appendEvidence(runId, ev)`
// is the contract this worktree consumes.
//
// Writes JSONL to `store/runs/{runId}/evidence.jsonl`. Best-effort: any FS
// error is logged + swallowed so the demo never crashes on a missing dir.

import fs from "fs";
import path from "path";
import type { SupplierEvidence } from "@/types/evidence";

function runDir(runId: string): string {
  return path.join(process.cwd(), "store", "runs", runId);
}

export function appendEvidence(runId: string, evidence: SupplierEvidence): void {
  try {
    const dir = runDir(runId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "evidence.jsonl");
    fs.appendFileSync(file, JSON.stringify(evidence) + "\n", "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[evidence-pool] append failed for run ${runId}:`, err);
  }
}

export function readEvidence(runId: string): SupplierEvidence[] {
  try {
    const file = path.join(runDir(runId), "evidence.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as SupplierEvidence);
  } catch {
    return [];
  }
}
