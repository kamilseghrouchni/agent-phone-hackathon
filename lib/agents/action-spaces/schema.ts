// Zod schema for a DAS action — used by the runtime loader to validate
// each YAML on boot. Authoring mistakes (typo in prerequisite, unknown
// slot source, missing success_criteria) fail loudly here, not at LLM
// call time.

import { z } from "zod";

export const ChannelName = z.enum(["call", "email", "sms", "form", "calendar"]);
export type ChannelName = z.infer<typeof ChannelName>;

export const ActionCategory = z.enum([
  "outreach",
  "question",
  "confirmation",
  "wrap",
  "action",
  "escalate",
]);
export type ActionCategory = z.infer<typeof ActionCategory>;

// Slot source grammar — strings the runtime knows how to resolve.
// Patterns:
//   parsed_query.<path>
//   supplier.<path>
//   prior.<action_id>.<field>
//   cross_channel.<field>
//   agent_identity.<field>
//   state.<path>
// A `literal:` value lives in its own discriminator below.
const SOURCE_PREFIXES = [
  "parsed_query.",
  "supplier.",
  "prior.",
  "cross_channel.",
  "agent_identity.",
  "state.",
] as const;

const SlotResolver = z.union([
  // Dynamic source — must start with a known prefix.
  z.object({
    source: z
      .string()
      .refine((s) => SOURCE_PREFIXES.some((p) => s.startsWith(p)), {
        message: `slot source must begin with one of: ${SOURCE_PREFIXES.join(", ")}`,
      }),
    format: z.string().optional(),
    fallback: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }),
  // Compile-time constant.
  z.object({
    literal: z.union([z.string(), z.number(), z.boolean()]),
  }),
]);

export const Extract = z.object({
  field: z.string().min(1),
  type: z.string().min(1), // free-form ("string" | "number" | "dict<...>" | "enum:a|b|c")
  description: z.string().optional(),
});

export const Action = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "action id must be snake_case"),
  category: ActionCategory,
  prerequisites: z.array(z.string()).default([]),
  extracts: z.array(Extract).default([]),

  // Text channels carry an utterance template; action channels carry
  // parameters. Exactly one of the two must be present.
  utterance_template: z.string().optional(),
  parameters: z.record(z.string(), SlotResolver).optional(),

  slots: z.record(z.string(), SlotResolver).default({}),
  success_criteria: z.string().min(1),
  next_action_hints: z.array(z.string()).default([]),

  // Channel-specific extras.
  cross_channel_required: z.boolean().optional(),
  fallback_for: z.string().optional(),
  submission_method: z.string().optional(),
}).refine(
  (a) => Boolean(a.utterance_template) !== Boolean(a.parameters),
  { message: "action must have exactly one of utterance_template or parameters" },
);

export const ActionSpace = z.object({
  channel: ChannelName,
  agent_persona_required: z.boolean().default(false),
  actions: z.array(Action).min(1),
});
export type ActionSpace = z.infer<typeof ActionSpace>;
export type Action = z.infer<typeof Action>;
