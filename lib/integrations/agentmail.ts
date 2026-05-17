// AgentMail integration. Real path uses the Node SDK; stub path writes
// to disk so the platform is fully clickable without API keys.
//
// Per-run inbox: crovi-run-<runId>@agentmail.to. All supplier threads
// for one run land in one inbox keyed by thread_id.
//
// Outbound envelope rule (demo mode): preserve supplier identity in the
// reply-to / from-name, but route delivery to DEMO_CALL_TARGET_EMAIL so
// the user's inbox sees every send.

import fs from "fs";
import path from "path";
import { AgentMailClient } from "agentmail";
import type { BiobankOpportunity } from "@/types/biobank";
import { resolveDestination, demoModeActive } from "./demo-mode";

const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxDomain = process.env.AGENTMAIL_INBOX_DOMAIN ?? "agentmail.to";

let client: AgentMailClient | null = null;
function getClient(): AgentMailClient | null {
  if (!apiKey) return null;
  if (!client) client = new AgentMailClient({ apiKey });
  return client;
}

export interface EmailSendResult {
  message_id: string;
  thread_id: string;
  inbox_address: string;
  sent_at: string;
  envelope: {
    from: string;
    to: string;
    original_to: string;     // before demo redirect — for narrative display
    subject: string;
    body: string;
  };
  mode: "real" | "stub";
}

function parseSubjectAndBody(rendered: string): { subject: string; body: string } {
  // Email YAML templates start with "Subject: ...\n\n<body>". Split on the
  // first blank line; if no blank line, treat the whole thing as the body.
  const trimmed = rendered.trimStart();
  const subjectMatch = /^subject:\s*(.+?)\r?\n(\r?\n)?/i.exec(trimmed);
  if (subjectMatch) {
    const subject = subjectMatch[1].trim();
    const body = trimmed.slice(subjectMatch[0].length).trim();
    return { subject, body };
  }
  return { subject: "(no subject)", body: trimmed };
}

function inboxAddressFor(runId: string): string {
  // AgentMail addresses can't have underscores or spaces. Slugify.
  const slug = runId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  return `crovi-run-${slug}@${inboxDomain}`;
}

export interface SendEmailInput {
  runId: string;
  runDir: string;
  supplier: BiobankOpportunity;
  rendered: string; // Builder output for an email action
}

export async function sendEmail(input: SendEmailInput): Promise<EmailSendResult> {
  const { runId, runDir, supplier, rendered } = input;
  const { subject, body } = parseSubjectAndBody(rendered);

  const originalTo = supplier.contact.email ?? "(no supplier email)";
  const actualTo = resolveDestination("email", originalTo) ?? originalTo;
  const inbox = inboxAddressFor(runId);
  const fromName = supplier.contact.bd_name
    ? `${supplier.contact.bd_name} (${supplier.name} BD)`
    : `${supplier.name} BD`;
  const sent_at = new Date().toISOString();

  const c = getClient();
  if (!c) {
    // Stub: write outbound to disk so UI can show it + demo flow continues.
    const outboxDir = path.join(runDir, "outbox", "email");
    fs.mkdirSync(outboxDir, { recursive: true });
    const stub_id = `stub_msg_${Date.now()}`;
    const stub_thread = `stub_thread_${supplier.id}`;
    const record = {
      message_id: stub_id,
      thread_id: stub_thread,
      inbox_address: inbox,
      sent_at,
      envelope: { from: `${fromName} <${inbox}>`, to: actualTo, original_to: originalTo, subject, body },
      mode: "stub" as const,
      demo_mode: demoModeActive(),
    };
    fs.writeFileSync(path.join(outboxDir, `${sent_at.replace(/[:.]/g, "-")}_${supplier.id}.json`), JSON.stringify(record, null, 2));
    return record;
  }

  // Real send. Inbox is created lazily on first send for this run.
  const username = inbox.split("@")[0];
  try {
    await c.inboxes.create({ username, domain: inboxDomain, displayName: `vCRO Audit ${runId}` });
  } catch {
    // already exists — fine
  }
  const sent = (await c.inboxes.messages.send(inbox, {
    to: [actualTo],
    subject,
    text: body,
    replyTo: [`${fromName} <${supplier.contact.email ?? inbox}>`],
  })) as unknown as { message_id?: string; messageId?: string; thread_id?: string; threadId?: string };
  return {
    message_id: sent.message_id ?? sent.messageId ?? `unknown_${Date.now()}`,
    thread_id: sent.thread_id ?? sent.threadId ?? `unknown_thread_${supplier.id}`,
    inbox_address: inbox,
    sent_at,
    envelope: { from: `${fromName} <${inbox}>`, to: actualTo, original_to: originalTo, subject, body },
    mode: "real",
  };
}

// Inbound webhook payload shape (subset we care about).
export interface InboundEmail {
  message_id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  text: string;       // extracted_text — quoted history stripped
  received_at: string;
}

export function parseInboundWebhook(raw: unknown): InboundEmail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // AgentMail's payload nests under .message — be permissive.
  const msg = (r.message ?? r) as Record<string, unknown>;
  const id = String(msg.message_id ?? msg.id ?? "");
  if (!id) return null;
  return {
    message_id: id,
    thread_id: String(msg.thread_id ?? ""),
    from: String(msg.from ?? ""),
    to: String(Array.isArray(msg.to) ? (msg.to as unknown[])[0] : msg.to ?? ""),
    subject: String(msg.subject ?? ""),
    text: String(msg.extracted_text ?? msg.text ?? ""),
    received_at: String(msg.received_at ?? new Date().toISOString()),
  };
}
