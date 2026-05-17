// lib/store/runs.ts
//
// File-system writers/readers for the per-run artifacts in
//   store/runs/{runId}/intake.json
//   store/runs/{runId}/evidence.jsonl
//   store/runs/{runId}/chain.json
//
// Pure node:fs — no DB needed for the demo. Append-only jsonl for evidence.

import fs from "node:fs";
import path from "node:path";
import type { IntakeForm } from "@/types/intake";
import type { SupplierEvidence } from "@/types/evidence";
import type { ChainState } from "@/types/chain";

function runDir(runId: string): string {
  return path.join(process.cwd(), "store", "runs", runId);
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

// -------- Intake --------

export function writeIntake(runId: string, intake: IntakeForm): void {
  const dir = runDir(runId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "intake.json"), JSON.stringify(intake, null, 2), "utf-8");
}

export function readIntake(runId: string): IntakeForm | null {
  const p = path.join(runDir(runId), "intake.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as IntakeForm;
}

// -------- Evidence (append-only jsonl) --------

export function appendEvidence(runId: string, ev: SupplierEvidence): void {
  const dir = runDir(runId);
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, "evidence.jsonl"), JSON.stringify(ev) + "\n", "utf-8");
}

export function readEvidence(runId: string): SupplierEvidence[] {
  const p = path.join(runDir(runId), "evidence.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SupplierEvidence);
}

// -------- Chain --------

export function writeChain(runId: string, chain: ChainState): void {
  const dir = runDir(runId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "chain.json"), JSON.stringify(chain, null, 2), "utf-8");
}

export function readChain(runId: string): ChainState | null {
  const p = path.join(runDir(runId), "chain.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as ChainState;
}
