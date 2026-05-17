# AgentMail

One-line: REST API that gives an AI agent its own email inbox — send, receive, thread, attach, webhook.

## What it gives us

- Programmatic inbox creation. `POST /v0/inboxes` returns an address on `@agentmail.to` by default; custom domain on paid plans (SPF/DKIM/DMARC managed by AgentMail).
- Send to any external address (gmail.com, corporate domains). Receive replies back into the same inbox.
- Automatic threading. Replies land in the same `thread_id` as the original outbound message.
- Inbound parsing. Each received message exposes `extracted_text` and `extracted_html` (reply body stripped of quoted history) plus attachment objects.
- Webhooks on `message.received`, `message.sent`, `message.delivered`, `message.bounced`, `message.complained`, `message.rejected`, `domain.verified`, and spam/blocked/unauthenticated variants. Webhooks return a secret for signature verification. Filter by `inbox_id` or `pod_id` (max 10 per hook).
- WebSocket alternative (AsyncAPI 2.6) if we don't want to expose a public webhook URL.
- Drafts (human-in-the-loop review before send), Labels (state machine per thread), Lists (allow/blocklist of domains), Pods (multi-tenant isolation).
- IMAP/SMTP fallback if we ever need raw protocol access.

## API surface

- Base URL: `https://api.agentmail.to/v0/`
- Auth: `Authorization: Bearer am_...` (API key from console). Scoped keys per inbox supported.
- Resources: `inboxes`, `messages`, `threads`, `drafts`, `attachments`, `domains`, `webhooks`, `lists`, `metrics`, `pods`.
- Message ops: `send`, `reply`, `reply_all`, `forward`, `batch_get`.
- SDKs: Python + Node.js, MIT-licensed. MCP server available (Claude / Cursor). Google ADK integration shipped.
- Send body shape: `{ to, cc, bcc, subject, text, html, reply_to, attachments[] }`.

## Pricing & limits

- Free: 3 inboxes, 3,000 emails/month, 3 GB, 100 emails/day cap.
- Developer: $20/mo, 10 inboxes, 10,000 emails/month, no daily cap.
- Startup: $200/mo, 150 inboxes, 150,000 emails/month. YC launch offer = one free month on Startup tier.
- Enterprise: BYOC, white-label.
- Custom domains gated to paid plans. Default `@agentmail.to` works for outbound to external recipients but may trip spam filters on cold outreach to corporate domains.
- Hackathon-specific credits: not published. Ask sponsor at kickoff (founders@agentmail.cc).

## What we can build with it for vCRO

- One inbox per run: `crovi-run-{run_id}@agentmail.to`. All 6 supplier threads land in one place, keyed by `thread_id`.
- On Deliver phase, for each row in External tab, `POST /messages/send` to the named BD contact with the spec from `request.json` rendered into subject + body. Attach a PDF spec sheet (150 plasma + 75 FFPE NSCLC, mutations, treatment-naive, IRB).
- Webhook `message.received` → Next.js route → parse `extracted_text` with Claude → write `{ supplier_id, status, quote, turnaround, available_n, raw_reply_id }` into `answer.json`. UI re-renders the External tab from updated JSON.
- Labels track per-thread state: `sent` → `replied` → `quoted` → `declined` / `negotiating`. Drives the External tab status pill.
- Allowlist set to the 6 supplier domains so the agent cannot accidentally email anyone else mid-demo.
- Live demo loop: kick off run, watch 6 outbound sends, have a teammate reply from one supplier address, watch the tab update in real time. Sells "passive list → active broker" in 30 seconds.

## Open questions

- Cold-send deliverability from `@agentmail.to` shared domain into corporate inboxes — what's the inbox-placement rate? Worth bringing one verified custom domain (e.g. `bd@crovi.bio`) on Developer plan as fallback.
- Attachment size cap on send + receive (not published in the pages we read).
- Signature scheme on webhook payloads (HMAC algorithm, header name) — confirm from `docs.agentmail.to/concepts/webhooks` or the SDK.
- Does `extracted_text` reliably strip Outlook / Apple Mail quoted history, or do we still need our own quote-stripper?
- Per-inbox sending rate-limits beyond the daily cap on Free.
- Hackathon credits / Startup-tier comp for the hackathon event.

## Links

- https://agentmail.to
- https://docs.agentmail.to
- https://docs.agentmail.to/api-reference
- https://docs.agentmail.to/quickstart
- https://www.agentmail.to/pricing
- https://console.agentmail.to
- https://news.ycombinator.com/item?id=46812608 (Launch HN)
- https://www.ycombinator.com/companies/agentmail
- https://events.ycombinator.com/CallMyAgentHackathon
