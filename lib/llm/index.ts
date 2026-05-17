// Provider-agnostic LLM facade — spec § 7.
//
// Three semantic operations the agents need:
//   plan()    — Planner picks one action from a constrained menu.
//   extract() — narrow JSON extraction from a counterparty response.
//   parse()   — natural-language → structured query (Understand agent).
//
// All three reduce to "structured output with a system prompt." Providers
// only have to implement generateObject + generateText; the helpers below
// wire the semantics.

import type { z } from "zod";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";

export interface GenerateTextOpts {
  system: string;
  prompt: string;
  model?: "fast" | "smart"; // provider maps to its own tier
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateObjectOpts<T> extends GenerateTextOpts {
  schema: z.ZodSchema<T>;
}

export interface LLMProvider {
  name: "anthropic" | "google";
  generateText(opts: GenerateTextOpts): Promise<string>;
  generateObject<T>(opts: GenerateObjectOpts<T>): Promise<T>;
}

function activeProvider(): LLMProvider {
  const choice = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  if (choice === "google" || choice === "gemini") return googleProvider;
  return anthropicProvider;
}

// ---- Semantic helpers --------------------------------------------------

// One per-turn Planner pick. The provider returns whatever shape `schema`
// describes; callers typically use { action_id, reasoning, slot_values }.
export async function plan<T>(opts: {
  system: string;
  state: unknown;
  schema: z.ZodSchema<T>;
}): Promise<T> {
  return activeProvider().generateObject({
    system: opts.system,
    prompt: JSON.stringify(opts.state),
    schema: opts.schema,
    model: "smart",
    temperature: 0.2,
  });
}

// Narrow extraction from a counterparty utterance. JSON-only by construction.
export async function extract<T>(opts: {
  system: string;
  response: string;
  schema: z.ZodSchema<T>;
}): Promise<T> {
  return activeProvider().generateObject({
    system: opts.system,
    prompt: opts.response,
    schema: opts.schema,
    model: "fast",
    temperature: 0,
  });
}

// User text/voice/PDF → structured ParsedQuery.
export async function parse<T>(opts: {
  system: string;
  input: string;
  schema: z.ZodSchema<T>;
}): Promise<T> {
  return activeProvider().generateObject({
    system: opts.system,
    prompt: opts.input,
    schema: opts.schema,
    model: "smart",
    temperature: 0.1,
  });
}

// Escape hatch for free-form text (Source agent narratives, digests, etc.).
export async function generateText(opts: GenerateTextOpts): Promise<string> {
  return activeProvider().generateText(opts);
}

export function getActiveProviderName(): "anthropic" | "google" {
  return activeProvider().name;
}
