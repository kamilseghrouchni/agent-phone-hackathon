import path from "path";
import fs from "fs";

// Returns the project root. The agents use this to write run artifacts
// under `<root>/store/runs/<runId>/`.
export function getRepoRoot(): string {
  return process.cwd();
}

// Lightweight progress emitter. The hackathon spec calls for SSE streaming
// from the runtime to the UI; until we wire that up we just append to a
// per-run progress log so artifacts are still inspectable post-hoc.
export function emitProgress(
  runDir: string,
  event: Record<string, unknown>
): void {
  try {
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
    const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    fs.appendFileSync(path.join(runDir, "progress.jsonl"), line + "\n");
  } catch {
    // Don't let logging failures break the run.
  }
}
