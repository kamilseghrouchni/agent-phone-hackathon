// DAS YAML loader + cross-action referential-integrity checker.
//
// Use loadActionSpace("call") to get a validated, dereferenceable space.
// Use validateAllActionSpaces() (at startup) to fail loudly on authoring
// errors before any LLM call burns tokens.

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { ActionSpace, type Action } from "./schema";

const SPACES_DIR = path.join(process.cwd(), "src/lib/agents/action-spaces");

const cache = new Map<string, ActionSpace>();

export function loadActionSpace(channel: "call" | "email" | "sms" | "form" | "calendar"): ActionSpace {
  const cached = cache.get(channel);
  if (cached) return cached;

  const file = path.join(SPACES_DIR, `${channel}.yaml`);
  const raw = fs.readFileSync(file, "utf-8");
  const parsed = YAML.parse(raw);
  const space = ActionSpace.parse(parsed);

  // Referential integrity — every prereq / hint must point at a real
  // action id in this channel.
  const ids = new Set(space.actions.map((a) => a.id));
  const violations: string[] = [];
  for (const a of space.actions) {
    for (const p of a.prerequisites) {
      if (!ids.has(p)) violations.push(`${channel}.${a.id}: prerequisite "${p}" not defined`);
    }
    for (const h of a.next_action_hints) {
      if (!ids.has(h)) violations.push(`${channel}.${a.id}: next_action_hint "${h}" not defined`);
    }
  }
  if (violations.length > 0) {
    throw new Error(`Action-space ${channel}.yaml referential errors:\n  - ${violations.join("\n  - ")}`);
  }

  cache.set(channel, space);
  return space;
}

export function validateAllActionSpaces(): {
  channel: string;
  actions: number;
  outreach: number;
  questions: number;
  actions_cat: number;
  wraps: number;
  escalates: number;
}[] {
  const channels: ("call" | "email" | "sms" | "form" | "calendar")[] = [
    "call",
    "email",
    "sms",
    "form",
    "calendar",
  ];
  return channels.map((ch) => {
    const space = loadActionSpace(ch);
    const byCat = (cat: string) => space.actions.filter((a) => a.category === cat).length;
    return {
      channel: ch,
      actions: space.actions.length,
      outreach: byCat("outreach"),
      questions: byCat("question"),
      actions_cat: byCat("action"),
      wraps: byCat("wrap"),
      escalates: byCat("escalate"),
    };
  });
}

export function findAction(channel: "call" | "email" | "sms" | "form" | "calendar", id: string): Action | undefined {
  return loadActionSpace(channel).actions.find((a) => a.id === id);
}
