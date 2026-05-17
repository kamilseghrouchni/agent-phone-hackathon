# AgentPhone

One-line: phone numbers (voice + SMS + iMessage) for AI agents, one REST API, no Twilio glue.

## What it gives us

- US/CA phone numbers provisioned by API call, attached to a named agent
- Outbound voice calls to any phone number, with streaming STT, sub-second TTS, barge-in, backchannel
- Inbound voice + SMS + iMessage routed to one webhook (unified event shape)
- Two voice modes:
  - `hosted` — built-in LLM runs the conversation from a `systemPrompt`
  - `webhook` — transcripts stream to our server; we return NDJSON; we pick the LLM
- Model tiers: `turbo`, `balanced` (default), `max`. STT modes `fast` or `accurate` (+~200ms)
- Live transcript via SSE, optional call recording, DTMF, voicemail message, `transferNumber` for hand-off to human
- iMessage tapback reactions, typing indicators, media
- Webhook events: `agent.message`, `agent.call_ended`, `agent.reaction` (HMAC-SHA256 signed)
- MCP server — usable directly from Claude Code / Cursor
- Telephony underneath: Twilio (confirmed in docs)

## API surface

- Base URL: `https://api.agentphone.ai/v1`
- Auth: `Authorization: Bearer YOUR_API_KEY`
- SDKs: Python (`pip install agentphone`, 3.9+, sync + async) and TypeScript (`npm install agentphone`, Node 18+, Deno, Bun, Cloudflare Workers)
- OpenAPI 3.1 spec at `docs.agentphone.ai/openapi.json`

Endpoints we will touch:
- `POST /v1/agents` — create agent (name, voice, voiceMode, systemPrompt, modelTier, beginMessage, transferNumber, voicemailMessage, enableMessaging)
- `POST /v1/numbers` — provision number
- `POST /v1/agents/{id}/numbers` — attach number to agent
- `POST /v1/calls` — create outbound call
- `POST /v1/messages` — send SMS / iMessage
- `GET /v1/calls/{id}` — call detail + transcript
- `GET /v1/calls/{id}/transcript/stream` — SSE live transcript
- `GET /v1/calls/{id}/recording` — audio URL
- `POST /v1/webhooks` — global webhook; per-agent webhooks also supported

Webhook security: verify `X-Webhook-Signature` + `X-Webhook-Timestamp` (HMAC-SHA256), reject >5min old, dedupe via `X-Webhook-ID`. Auto-retry up to 6 times over ~24h.

## Pricing & limits

- $5.00 free credit per new account
- Phone number: $3.00 / month
- Voice (webhook mode): $0.13 / min
- Voice (hosted mode): $0.22 / min
- SMS: $0.02 / message
- Recording add-on: $5.00 / month
- Aggressive denoising: +$0.005 / min
- Pay-as-you-go; balance management via API
- SMS 10DLC daily caps: sole-prop ~3k segments/day at 2.25 MPS up to highest-trust ~600k/day at 225 MPS. Excess auto-queued, not dropped
- iMessage: unlimited inbound replies within 24h, 200 follow-up contacts/day/line, 5 cold-outbound contacts/day/line
- Voice webhook timeout: 30s default, configurable 5–120s
- Hackathon offer: not published; expect sponsor credits announced at kickoff

## What we can build with it for vCRO

The External tab today lists 6 commercial biobanks passively. Wire it to AgentPhone.

1. **Per-supplier outbound call agent.** One agent per BD contact: `Daria @ Biomedica CRO`, `Tetiana @ PrimeBio Net`, `Inga @ Reference Medicine`, etc. `voiceMode=hosted`, `systemPrompt` carries the intake spec ("150 plasma + 75 FFPE NSCLC Stage III-IV, EGFR/KRAS/ALK, treatment-naive, IRB approved"), `beginMessage` introduces vCRO, `transferNumber` falls back to a human on escalation.
2. **Parallel dial-out from External tab.** Server action takes the intake form, fires `POST /v1/calls` to all 6 suppliers in parallel, returns call IDs. Frontend subscribes to per-call SSE transcripts and shows live status: "Daria — discussing FFPE availability...".
3. **Structured extraction on `agent.call_ended`.** Webhook receives full transcript, we run a Claude pass that extracts `{available, lead_time_days, quote_usd, caveats}`, write to `store/runs/{run}/external_quotes.json`, merge into the External tab rows.
4. **SMS follow-up with the written spec.** Immediately after each call, `POST /v1/messages` sends the intake PDF + machine-readable spec to the BD contact for paper trail. Inbound replies arrive on the same webhook as `agent.message` and update the quote row.
5. **Human hand-off.** When the agent hits "I need to check with my team," `transferNumber` warm-transfers to the requesting BD lead at the client. No code change.

Pair with Browser Use for Reference Medicine's online inventory portal, AgentMail for the structured spec email, Moss for in-call semantic lookup of cohort criteria — AgentPhone owns the voice leg of "The Fixer."

## Open questions

- Languages supported for STT/TTS — not stated; the 6 BD contacts include EU partners (Ukrainian, Italian, German names). Ask sponsors.
- Concurrent outbound call cap per account — not in docs.
- Tool/function calling in `hosted` mode — implied but the schema isn't shown. Confirm at kickoff or use `webhook` mode and own the tool loop.
- Median end-to-end voice latency number — only "sub-second TTS" is published.
- Hackathon credit amount and how to redeem (likely a code at kickoff).
- Number provenance for outbound (caller ID branding, STIR/SHAKEN attestation level) — BD contacts may auto-reject unknown numbers.
- Whether `enableMessaging` mid-call lets the agent text the BD contact a calendar link during the call.

## Links

- https://www.agentphone.ai/
- https://www.ycombinator.com/companies/agentphone
- https://docs.agentphone.ai/
- https://docs.agentphone.ai/api-reference
- https://docs.agentphone.ai/documentation/guides/calls.mdx
- https://docs.agentphone.ai/documentation/guides/conversations.mdx
- https://docs.agentphone.ai/documentation/reference/messaging-rate-limits.mdx
- https://docs.agentphone.ai/documentation/reference/best-practices.mdx
- https://docs.agentphone.ai/openapi.json
- https://discord.gg/sbNJDZbYmn
- https://events.ycombinator.com/CallMyAgentHackathon
