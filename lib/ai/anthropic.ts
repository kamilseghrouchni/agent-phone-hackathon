import { createAnthropic } from "@ai-sdk/anthropic";

// Routes through Vercel AI Gateway by default so usage shows up in one
// dashboard alongside the local `claude` CLI traffic. Falls back to direct
// Anthropic if ANTHROPIC_BASE_URL is unset (e.g. on a clean Vercel deploy
// where you only set ANTHROPIC_API_KEY).
const baseURL =
  process.env.ANTHROPIC_BASE_URL ?? "https://ai-gateway.vercel.sh";

const apiKey =
  process.env.VERCEL_AI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";

export const anthropic = createAnthropic({ baseURL, apiKey });

export function hasLLMKey(): boolean {
  return Boolean(process.env.VERCEL_AI_API_KEY || process.env.ANTHROPIC_API_KEY);
}
