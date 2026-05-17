// Builder — deterministic, no LLM. Given a chosen Action + a resolution
// context, renders the wire payload.
//
// Text channels (call/email/sms) → returns a rendered utterance string.
// Action channels (form/calendar) → returns a parameters object whose
// values are resolved slot strings; the integration adapter interprets.
//
// Hallucination-free by construction: the LLM never produces the final
// outbound text, only the action choice and the slot value source-paths.

import type { Action } from "../action-spaces/schema";
import { resolveSlots, type ResolveContext, type SlotResolver } from "./slot-resolver";

export type BuiltUtterance = { kind: "utterance"; text: string; slot_values: Record<string, string> };
export type BuiltParameters = { kind: "parameters"; values: Record<string, string>; submission_method?: string };
export type BuiltAction = BuiltUtterance | BuiltParameters;

function applyTemplate(template: string, values: Record<string, string>): string {
  // Replace every {key} with values[key] (or "" if unresolved). Keep
  // literal braces if they wrap a key we don't know — fail loudly upstream
  // by leaving the placeholder so it's visible in the UI preview.
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : `{${key}}`,
  );
}

export function buildAction(action: Action, ctx: ResolveContext): BuiltAction {
  // Text-channel actions carry an utterance_template + slots.
  if (action.utterance_template) {
    const slotValues = resolveSlots((action.slots ?? {}) as Record<string, SlotResolver>, ctx);
    const text = applyTemplate(action.utterance_template, slotValues).trim();
    return { kind: "utterance", text, slot_values: slotValues };
  }

  // Action-channel actions carry a `parameters` map.
  if (action.parameters) {
    const values = resolveSlots(action.parameters as Record<string, SlotResolver>, ctx);
    return { kind: "parameters", values, submission_method: action.submission_method };
  }

  throw new Error(`Action "${action.id}" has neither utterance_template nor parameters.`);
}
