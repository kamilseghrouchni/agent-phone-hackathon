import { generateText as aiGenerateText, generateObject as aiGenerateObject } from "ai";
import { anthropic } from "@/lib/ai/anthropic";
import type { LLMProvider, GenerateObjectOpts, GenerateTextOpts } from "./index";

// Sonnet 4.6 = our reasoning tier (Planner, parse).
// Haiku 4.5  = the fast tier (Extractor, digests).
const MODEL = {
  smart: "claude-sonnet-4-6",
  fast: "claude-haiku-4-5-20251001",
};

function pickModel(tier?: "fast" | "smart") {
  return anthropic(tier === "fast" ? MODEL.fast : MODEL.smart);
}

export const anthropicProvider: LLMProvider = {
  name: "anthropic",

  async generateText(opts: GenerateTextOpts): Promise<string> {
    const { text } = await aiGenerateText({
      model: pickModel(opts.model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
    });
    return text;
  },

  async generateObject<T>(opts: GenerateObjectOpts<T>): Promise<T> {
    const { object } = await aiGenerateObject({
      model: pickModel(opts.model),
      system: opts.system,
      prompt: opts.prompt,
      schema: opts.schema,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
    });
    return object as T;
  },
};
