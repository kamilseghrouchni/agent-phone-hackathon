// Gemini adapter — stub. Activated when DeepMind credits land at the
// hackathon and LLM_PROVIDER=google is set. We deliberately don't pull in
// @ai-sdk/google until that moment to keep the dependency graph clean.

import type { LLMProvider, GenerateObjectOpts, GenerateTextOpts } from "./index";

function notImplemented(): never {
  throw new Error(
    "Google/Gemini provider not wired. Install @ai-sdk/google, swap this " +
      "stub for the real adapter, and set LLM_PROVIDER=google.",
  );
}

export const googleProvider: LLMProvider = {
  name: "google",
  async generateText(_opts: GenerateTextOpts): Promise<string> {
    notImplemented();
  },
  async generateObject<T>(_opts: GenerateObjectOpts<T>): Promise<T> {
    notImplemented();
  },
};
