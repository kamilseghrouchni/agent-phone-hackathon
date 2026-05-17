# Crovi (crovi.bio)

User-owned demo "meta supplier." Single-page landing built statically (no `<form>` element on page); intake is a 3-step JS modal that POSTs to a Make.com webhook. Meetings booked via Notion Calendar. No auth wall, no captcha on either surface.

## Homepage surfaces

- Canonical: `https://crovi.bio/`
- Title: "Crovi — AI-native biospecimen procurement for biotech"
- Nav anchors: `#problem`, `#features`, `#contact`
- Two primary CTAs, repeated in hero, footer, and final section:
  - "Request a meeting" → `https://calendar.notion.so/meet/kamilseghrouchni/fk7kv4pyk`
  - "Use our agents" → `href="#"`, opens the agent modal (`#agents` hash or any `[data-agents-open]` trigger; URL rewritten to `/agent-launched` on open)
- Footer "Platform" links: `#features`, `#problem`, "Use our agents"
- Footer "Contact" links: `mailto:agents@crovi.bio`, "Request a meeting" (same Notion URL)
- Legal: `/privacy`, `/terms` (not investigated)
- Analytics: GTM `AW-18153935111` (Google Ads), Vercel Insights, `hls.js` CDN — no Segment / Hubspot / Salesforce pixel detected.

## `/agent-launched` form spec

Loading `/agent-launched` directly auto-opens the modal `#bmodal` over the homepage. Three panes, advanced client-side; the URL `/agent-launched` is purely a deep-link convention, not a separate page.

- Submission endpoint: `POST https://hook.eu2.make.com/kt959y82ammpq8humsizxxy2hutw1b2t`
- Method: `fetch`, `Content-Type: application/json`
- No captcha, no auth, no honeypot.
- No `<form>` element; pure JS handlers on buttons.

Payload sent on Step 2 submission:

```json
{
  "threadId": "REQ-XXXX",            // generated client-side, 'REQ-' + 4-digit random
  "email": "<step2 email>",
  "prompt": "<step1 textarea>",
  "submittedAt": "<ISO timestamp>",
  "source": "crovi.bio/agent-launched",
  "userAgent": "<navigator.userAgent>"
}
```

Step-by-step fields:

| Step | id | Type | Required | Validation | Notes |
|---|---|---|---|---|---|
| 1 — Prompt | `#bmodal-prompt` | `<textarea>` | yes | `value.trim().length >= 10` enables Continue | placeholder example: "50 treatment-naïve NSCLC FFPE blocks, ≥30% tumor cellularity, paired with matched blood — need bulk RNA-seq + WES. EU sites preferred. Budget $120k, delivery within 12 weeks." No maxLength. |
| 2 — Identity | `#bmodal-email` | `<input type="email">` | yes | regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | autocomplete=email; only field on this step |
| 3 — Waitlist | (read-only) | n/a | n/a | n/a | Echoes `REQ-XXXX` into `#bmodal-threadid` and email into `#bmodal-email-echo`; status text "On the waitlist" |

Buttons: `#bmodal-next-1` (Continue), `#bmodal-back-2` (Back), `#bmodal-next-2` (Send to agents), `#bmodal-done` (Back to landing), `#bmodal-close` (×). On failure, error div `.bmodal-err` shows "Could not reach our intake service. Please try again in a moment."

No file upload, no dropdown, no multi-select, no tier/SKU picker. The single textarea is the entire structured payload.

## Notion Calendar booking flow

- URL: `https://calendar.notion.so/meet/kamilseghrouchni/fk7kv4pyk`
- Meeting label: "Let's Chat - Intro", 15 min, organizer Kamil Seghrouchni
- Pre-filled note: "Conversation will probably flow towards data needs (omics, clinical) for training in silico AI models of diseases" (editable textbox on every step)

Step 1 — Pick date and time:
- Month calendar grid. Disabled buttons for past dates and unavailable days (weekends greyed). Available days observed: Mon–Fri only.
- Time zone selector defaults to viewer's tz (e.g. `Los Angeles GMT−7`); combobox switches tz.
- Time slot buttons in 15-min increments, business hours.

Step 2 — Enter details (revealed after time-slot click):
- `Name*` — text input, required
- `Email*` — input type=email, required
- `Location*` — radio group `name="meetingLocation"`, required, three options: `outboundPhoneCall` ("Phone call"), `conferencing` ("Google Meet"), `inPerson` ("San Francisco, CA, USA")
- Optional notes textbox carries over from step 1
- Buttons: "Back", "Schedule meeting" (disabled until required fields valid)
- No captcha, no SSO, no login wall observed at this stage.

## Public contact channels

- Email: `agents@crovi.bio` (only address; no `sales@`, `hello@`, `support@`)
- Meeting: Notion Calendar link above
- Agent intake modal (the form on `/agent-launched`)
- No phone, no street address, no social links, no LinkedIn URL on page.

## What this means for our agent

- **Fill agent** → Target `crovi.bio/agent-launched`. Two real fields: `prompt` (free-text, ≥10 chars) and `email` (RFC-ish email). Skip the UI entirely and POST JSON directly to `https://hook.eu2.make.com/kt959y82ammpq8humsizxxy2hutw1b2t` with the payload shape above — that's the production path the page itself uses. Generate our own `threadId` (e.g. `REQ-` + 4 digits) or echo our run id. No captcha. Confirmation = HTTP 2xx; user-visible state in the demo can mirror "REQ-XXXX on the waitlist."
- **Calendar agent** → Target the Notion Calendar URL. Headless-browser flow only (no public REST). Sequence: open URL → wait for calendar grid → click first non-disabled date button → click first non-disabled time slot → fill Name, Email, select `meetingLocation` radio (`conferencing` for Google Meet is the safest default) → click "Schedule meeting." 4 inputs total. No captcha, no SSO, but DOM is dynamic — selectors must rely on roles/labels, not stable ids.
- **Correspond agent** → Single inbox `agents@crovi.bio`. No named-person aliases. Subject prefixing optional; body should reference the `REQ-XXXX` thread id from the Fill action to thread continuity.

## Screenshots

- `_screenshots/crovi-bio-homepage.png`
- `_screenshots/crovi-bio-agent-launched-step1.png`
- `_screenshots/crovi-bio-agent-launched-step2.png`
- `_screenshots/crovi-bio-notion-calendar-step1.png`
- `_screenshots/crovi-bio-notion-calendar-step2.png`

## Links

- Home: https://crovi.bio/
- Agent intake modal (deep link): https://crovi.bio/agent-launched
- Make.com webhook (intake target): https://hook.eu2.make.com/kt959y82ammpq8humsizxxy2hutw1b2t
- Notion Calendar booking: https://calendar.notion.so/meet/kamilseghrouchni/fk7kv4pyk
- Email: mailto:agents@crovi.bio
