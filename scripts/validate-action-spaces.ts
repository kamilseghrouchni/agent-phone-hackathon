// Validates all DAS YAMLs and prints a per-channel summary. Run with:
//
//   npx tsx scripts/validate-action-spaces.ts
//
// Exits non-zero if any YAML fails schema validation or referential check.

import { loadActionSpace, validateAllActionSpaces } from "../src/lib/agents/action-spaces/loader";

try {
  const summary = validateAllActionSpaces();
  console.log("DAS validation\n");
  console.log("channel    total  outreach  question  action  wrap  escalate");
  console.log("-".repeat(64));
  let total = 0;
  for (const s of summary) {
    total += s.actions;
    console.log(
      s.channel.padEnd(11) +
        String(s.actions).padEnd(7) +
        String(s.outreach).padEnd(10) +
        String(s.questions).padEnd(10) +
        String(s.actions_cat).padEnd(8) +
        String(s.wraps).padEnd(6) +
        String(s.escalates).padEnd(10),
    );
  }
  console.log("-".repeat(64));
  console.log(`${total} actions across ${summary.length} channels\n`);

  // Spot-check: surface every cross_channel action and every fallback_for.
  for (const ch of ["call", "email", "sms", "form", "calendar"] as const) {
    const space = loadActionSpace(ch);
    const cross = space.actions.filter((a) => a.cross_channel_required);
    const fallbacks = space.actions.filter((a) => a.fallback_for);
    if (cross.length) {
      console.log(`${ch}: cross-channel actions  ${cross.map((a) => a.id).join(", ")}`);
    }
    if (fallbacks.length) {
      console.log(`${ch}: fallback actions       ${fallbacks.map((a) => `${a.id} (${a.fallback_for})`).join(", ")}`);
    }
  }

  // Verify the demo-path chain is closed in the call channel:
  // introduce_request → ask_availability → ask_price_per_case → wrap_with_followup
  const callSpace = loadActionSpace("call");
  const findHints = (id: string) => callSpace.actions.find((a) => a.id === id)?.next_action_hints ?? [];
  const path = ["introduce_request", "ask_availability", "ask_price_per_case", "wrap_with_followup"];
  for (let i = 0; i < path.length - 1; i++) {
    const hints = findHints(path[i]);
    if (!hints.includes(path[i + 1])) {
      throw new Error(`call demo path broken: ${path[i]}.next_action_hints lacks ${path[i + 1]}`);
    }
  }
  console.log("\ncall demo path:  introduce_request → ask_availability → ask_price_per_case → wrap_with_followup ✓");
} catch (err) {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
}
