/*
 * setup-agentphone.ts — one-shot provisioning for the AgentPhone integration.
 *
 *   WEBHOOK_BASE_URL=https://yourngrok.app npm run setup:agentphone
 *
 * What it does, in order:
 *   1. Loads AGENTPHONE_API_KEY from .env.local
 *   2. Reuses (or creates) the "Crovi Procurement BD" hosted-mode voice agent
 *      with VOICE_PERSONA_SYSTEM_PROMPT as its system prompt.
 *   3. Provisions a phone number (or reuses the first existing one).
 *   4. Attaches the number to the agent.
 *   5. Registers the webhook URL at ${WEBHOOK_BASE_URL}/api/webhooks/agentphone
 *      and captures the freshly-rotated secret.
 *   6. Fires testWebhook() to confirm round-trip.
 *   7. Prints the paste-into-.env.local block.
 *
 * Idempotent: re-running with the same agent name reuses the existing agent
 * instead of erroring. The webhook endpoint is upsert-style on the vendor side
 * (createOrUpdateWebhook), so re-runs just rotate the secret.
 */

import fs from "fs";
import path from "path";
import { AgentPhoneClient, AgentPhone } from "agentphone";
import { VOICE_PERSONA_SYSTEM_PROMPT } from "../lib/agents/voice-persona";

const AGENT_NAME = "Crovi Procurement BD";
const BEGIN_MESSAGE =
  "Hi, this is the NovaCure procurement agent following up on our intake form for the Stage III to IV NSCLC liquid-biopsy study. Do you have a minute for three quick feasibility questions?";
const DEFAULT_VOICE = "Polly.Amy";

// ---------------------------------------------------------------------------
// .env.local loader — no `dotenv` dependency in this repo, so parse manually.
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    // Strip inline comments (only if there's a space before the #)
    const hashIdx = v.search(/\s#/);
    if (hashIdx >= 0) v = v.slice(0, hashIdx).trim();
    // Strip quotes if present
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Helpers — log + bail.
// ---------------------------------------------------------------------------

function info(msg: string): void {
  process.stdout.write(`[setup] ${msg}\n`);
}

function bail(msg: string, code = 1): never {
  process.stderr.write(`[setup] ERROR: ${msg}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function findOrCreateAgent(
  client: AgentPhoneClient,
): Promise<AgentPhone.AgentResponse> {
  info(`step 1/6 — locating or creating agent "${AGENT_NAME}"`);
  const list = (await client.agents.listAgents()) as AgentPhone.AgentListResponse;
  // The SDK returns either { agents: [...] } or a paginated shape. Be lenient.
  const records: AgentPhone.AgentResponse[] = Array.isArray(
    (list as unknown as { agents?: AgentPhone.AgentResponse[] }).agents,
  )
    ? ((list as unknown as { agents: AgentPhone.AgentResponse[] }).agents)
    : Array.isArray(list as unknown)
      ? (list as unknown as AgentPhone.AgentResponse[])
      : [];

  const existing = records.find((a) => a.name === AGENT_NAME);
  if (existing) {
    info(`  reused existing agent id=${existing.id}`);
    return existing;
  }
  const created = (await client.agents.createAgent({
    name: AGENT_NAME,
    voiceMode: "hosted",
    systemPrompt: VOICE_PERSONA_SYSTEM_PROMPT,
    beginMessage: BEGIN_MESSAGE,
    voice: DEFAULT_VOICE,
  })) as AgentPhone.AgentResponse;
  info(`  created agent id=${created.id}`);
  return created;
}

async function findOrCreateNumber(
  client: AgentPhoneClient,
  agent: AgentPhone.AgentResponse,
): Promise<AgentPhone.PhoneNumberResponse> {
  info(`step 2/6 — locating or provisioning a phone number`);
  // If the agent already has a number attached, reuse it.
  if (agent.numbers && agent.numbers.length > 0) {
    const attached = agent.numbers[0];
    info(`  reused attached number id=${attached.id} ${attached.phoneNumber}`);
    // The AgentNumberResponse shape is a subset of PhoneNumberResponse; cast
    // is safe for the fields we use downstream (id + phoneNumber).
    return attached as unknown as AgentPhone.PhoneNumberResponse;
  }
  const list = (await client.numbers.listNumbers()) as AgentPhone.PhoneNumberListResponse;
  const records: AgentPhone.PhoneNumberResponse[] = Array.isArray(
    (list as unknown as { numbers?: AgentPhone.PhoneNumberResponse[] }).numbers,
  )
    ? ((list as unknown as { numbers: AgentPhone.PhoneNumberResponse[] }).numbers)
    : Array.isArray(list as unknown)
      ? (list as unknown as AgentPhone.PhoneNumberResponse[])
      : [];
  const unattached = records.find((n) => !n.agentId);
  if (unattached) {
    info(`  reused unattached number id=${unattached.id} ${unattached.phoneNumber}`);
    return unattached;
  }
  const created = (await client.numbers.createNumber()) as AgentPhone.PhoneNumberResponse;
  info(`  provisioned new number id=${created.id} ${created.phoneNumber}`);
  return created;
}

async function attachIfNeeded(
  client: AgentPhoneClient,
  agent: AgentPhone.AgentResponse,
  numberId: string,
): Promise<void> {
  info(`step 3/6 — attaching number ${numberId} to agent ${agent.id}`);
  const alreadyAttached =
    agent.numbers?.some((n) => n.id === numberId) ?? false;
  if (alreadyAttached) {
    info(`  already attached — skipping`);
    return;
  }
  try {
    await client.agents.attachNumberToAgent({
      agent_id: agent.id,
      numberId,
    });
    info(`  attached`);
  } catch (err) {
    // Vendor returns 4xx if the number is already attached to *this* agent.
    info(`  attach call returned: ${err instanceof Error ? err.message : String(err)} (continuing)`);
  }
}

async function registerWebhook(
  client: AgentPhoneClient,
  webhookUrl: string,
): Promise<AgentPhone.WebhookResponse> {
  info(`step 4/6 — registering webhook at ${webhookUrl}`);
  const res = (await client.webhooks.createOrUpdateWebhook({
    url: webhookUrl,
    contextLimit: 10,
  })) as AgentPhone.WebhookResponse;
  info(`  registered webhook id=${res.id} (new secret rotated)`);
  return res;
}

async function testWebhook(client: AgentPhoneClient): Promise<void> {
  info(`step 5/6 — firing test webhook`);
  try {
    await client.webhooks.testWebhook();
    info(`  test webhook fired — check your endpoint's logs for the delivery`);
  } catch (err) {
    info(
      `  test webhook call returned: ${err instanceof Error ? err.message : String(err)} (the endpoint may not be reachable yet — that's fine, you can retest later)`,
    );
  }
}

function printPasteBlock(opts: {
  agentId: string;
  phoneNumber: string;
  secret: string;
  webhookUrl: string;
}): void {
  const line = "─".repeat(64);
  process.stdout.write("\n" + line + "\n");
  process.stdout.write("step 6/6 — AgentPhone setup complete.\n");
  process.stdout.write(line + "\n");
  process.stdout.write("Paste these into .env.local:\n\n");
  process.stdout.write(`  AGENTPHONE_VOICE_AGENT_ID=${opts.agentId}\n`);
  process.stdout.write(`  AGENTPHONE_PHONE_NUMBER=${opts.phoneNumber}\n`);
  process.stdout.write(`  AGENTPHONE_WEBHOOK_SECRET=${opts.secret}\n\n`);
  process.stdout.write(`Webhook URL registered: ${opts.webhookUrl}\n`);
  process.stdout.write(line + "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvLocal();

  const token = process.env.AGENTPHONE_API_KEY;
  if (!token) {
    bail(
      "AGENTPHONE_API_KEY not found in .env.local. Sign up at agentphone.ai, grab your token, and paste it into the AgentPhone block of .env.local.",
    );
  }

  // Webhook URL must come from a CLI arg or WEBHOOK_BASE_URL env.
  const argUrl = process.argv.slice(2).find((s) => !s.startsWith("--"));
  const baseUrl = argUrl ?? process.env.WEBHOOK_BASE_URL ?? "";
  if (!baseUrl) {
    bail(
      "Webhook base URL missing. Re-run with: WEBHOOK_BASE_URL=https://yourngrok.app npm run setup:agentphone\n  (start ngrok via `ngrok http 3000` first; copy the https URL)",
    );
  }
  const webhookUrl = `${baseUrl.replace(/\/+$/, "")}/api/webhooks/agentphone`;

  const client = new AgentPhoneClient({
    token,
    baseUrl: process.env.AGENTPHONE_BASE_URL || undefined,
  });

  const agent = await findOrCreateAgent(client);
  const number = await findOrCreateNumber(client, agent);
  await attachIfNeeded(client, agent, number.id);
  const webhook = await registerWebhook(client, webhookUrl);
  await testWebhook(client);

  printPasteBlock({
    agentId: agent.id,
    phoneNumber: number.phoneNumber,
    secret: webhook.secret,
    webhookUrl,
  });
}

main().catch((err) => {
  bail(err instanceof Error ? err.stack ?? err.message : String(err));
});
