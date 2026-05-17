# YC Call My Agent Hackathon — locked demo design

**For:** YC Call My Agent Hackathon, San Francisco
**Replaces direction of:** `softening-arc-spec.md` (this doc is the implementation truth)
**Status:** No open questions. Implementation-ready.

---

## TL;DR — what we demo

The agent closes a procurement contract from a buyer's PDF intake to a settled payment + calendar invite, live on stage. Five beats:

1. **Upload** — drop a real biospecimen procurement intake PDF (NovaCure / NSCLC). Agent extracts 35 fields into the IntakeForm.
2. **Confirm** — top-strip shows the 6 search-key fields with inline edit + chips. Full intake collapsible. One CTA.
3. **Enrich** — 3 real concurrent Browser Use sessions scrape RefMed (+XLSX download), Geneticist (About page), Audubon (form portal). Each card has a clickable Chromium iframe. Crovi.bio appears as a 4th card from internal directory. Each card gets a conviction tier.
4. **Launch** — multi-select cards. Pick crovi.bio (pragmatic — we can't real-email the others). Sequence template strip shows the 5-stage chain.
5. **Chain** — Form (waitlist) → Call (3 substantive questions, your phone rings) → Email + Quote (filled intake + price benchmark) → SMS (you authorize "$10 down payment") → Stripe transfer ($10 lands in your Revolut) → Calendar invite. Filled Intake §1-8 + Quote shown side-by-side as climax.

Five sponsors fire live: **AgentMail · Browser Use · AgentPhone · Stripe · Supermemory**. Sponge stays as a swap-in option for the payment rail.

---

## §1 Architecture

```
                ┌─────────────────────────────────────────┐
                │  Buyer Intake PDF (35 fields)           │
                │  Frozen=11  Confirmable=17  Updatable=7 │
                │  Agent-filled §7+§8=10                  │
                └────────────────┬────────────────────────┘
                                 │ extract (hash-fastpath or LLM fallback)
                                 ▼
   ┌───────────────────────────────────────────────────────────┐
   │  IntakeForm  (single instance per run)                    │
   │  SupplierEvidence pool  (heap of {supplier,field,channel}) │
   │  ChainState (per-supplier 5-stage runtime)                │
   └─┬──────────┬──────────┬──────────┬──────────┬─────────────┘
     │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼
  Browser    AgentMail  AgentPhone  Stripe   Supermemory
   Use       (email)    (voice+SMS) (pay)    (call memory)
     │          │          │          │          │
     └──────────┴──────────┴──────────┴──────────┘
                          │  webhooks
                          ▼
            Evidence pool fills with provenance
                          │
                          ▼
       Filled Intake §1-8 + Quote PDF + Cal invite + Revolut push
```

The intake is never duplicated per supplier. Evidence is per (supplier, field, channel, evidence_id). At supplier-selection time, the system projects the evidence pool onto the intake's confirmable+updatable rows — that projection is the "Filled Intake" view.

---

## §2 The 35-field intake — categorized

Every field has one of four classes. Frozen = buyer's truth, agent never overwrites. Confirmable = buyer's assumption that supplier replies validate (green ✓). Updatable = buyer's preference that supplier reality may overwrite (blue ↻). Agent-filled = §7 + new §8.

| § | Field | Class | Flip trigger |
|---|---|---|---|
| 1 | Company, Contact, Title, Email, Phone, Study Name | 🔒 Frozen | — |
| 1 | Requested Timeline | 🔒 (annotated) | Supplier ETA appears beside it |
| 2 | Purpose of Request | 🔒 | — |
| 2 | Therapeutic Area (NSCLC) | 🔒 | — |
| 2 | IRB / Ethics Status | ✓ Confirmable | Call/email confirms supplier IRB compatibility |
| 2 | Patient Consent Requirements | ✓ | Supplier confirms broad-research works |
| 2 | Special Regulatory (CAP/CLIA) | ✓ | Supplier replies on CAP/CLIA alignment |
| 3 | Specimen Type(s) Requested | ↻ Updatable | Supplier offers actual mix |
| 3 | Diagnosis (Stage III-IV NSCLC) | 🔒 | — |
| 3 | Total Quantity (150/75) | ✓ | Aggregate supplier availability vs ask |
| 3 | Collection Timepoints | ✓ | Supplier confirms pre-treatment exists |
| 3 | Sample Format (frozen plasma/FFPE/slides) | ↻ | Supplier offers actual format |
| 3 | Minimum Volume (2 mL plasma) | ✓ | Supplier confirms ≥2 mL |
| 3 | Aliquot Requirements (2 per) | ↻ | Supplier may offer 1 or 3 |
| 3 | Matched Normal Required (Yes) | ✓ | Supplier confirms |
| 3 | Longitudinal Required (No) | 🔒 | — |
| 4 | Age Range (40-80) | ✓ | Cohort falls in range |
| 4 | Gender (no pref) | 🔒 | — |
| 4 | Ethnicity (diverse preferred) | ✓ | Supplier confirms diversity |
| 4 | Disease Stage (advanced metastatic) | 🔒 | — |
| 4 | Treatment History (naive preferred) | ✓ | Supplier confirms naive subset |
| 4 | Inclusion (NSCLC + path report) | ✓ | Supplier confirms path reports |
| 4 | Exclusion (prior immunotherapy) | ✓ | Supplier confirms exclusion handling |
| 4 | Biomarker (EGFR+/KRAS+/ALK) | ↻ | Supplier reports per-subset rate (RefMed XLSX) |
| 5 | Pathology Reports Required | ✓ | Supplier confirms |
| 5 | EMR / Clinical Data | ✓ | Supplier confirms |
| 5 | Genomic / Molecular Data | ↻ | Supplier reports actual |
| 5 | De-identified or Coded | 🔒 | — |
| 5 | Additional Docs (SOPs) | ✓ | Supplier confirms SOP availability |
| 6 | Preferred Shipping Schedule | ↻ | Supplier may offer different cadence |
| 6 | Temperature Requirements | ✓ | Supplier confirms |
| 6 | Domestic or International | 🔒 (risk flag) | Non-US supplier triggers §7 risk note |
| 6 | Packaging (IATA) | ✓ | Supplier confirms |
| 6 | Preferred Supplier (AMC) | ✓ (risk flag) | Commercial-only set triggers §7 risk note |
| 6 | Special Handling (avoid freeze-thaw) | ✓ | Supplier confirms |
| 7 | Potential Suppliers, Availability, ETA, Status, Risks, Notes | 🤖 Agent-filled | Computed at chain end |
| 8 | Contract acceptance, Down payment, Meeting, Status (NEW) | 🤖 Agent-filled | Computed at chain end |

**Totals: 11 🔒 / 17 ✓ / 7 ↻ / 6 §7 + 4 §8 = 35 fields.**

---

## §3 Schema

```ts
// types/intake.ts (NEW)
type FieldStatus = "frozen" | "empty" | "confirmed" | "updated" | "agent_filled";

interface IntakeField {
  field_id: string;             // e.g. "specimen.format"
  section: 1|2|3|4|5|6|7|8;
  label: string;
  class: "frozen" | "confirmable" | "updatable" | "agent_filled";
  value: unknown;               // buyer's value (or null for §7/§8 until filled)
  status: FieldStatus;
  provenance?: { supplier_id: string; channel: Channel; evidence_id: string; quote?: string };
}

interface IntakeForm {
  run_id: string;
  source: { type: "pdf"|"text"; filename?: string; hash?: string };
  buyer: { company: string; contact: string; email: string; phone: string };
  fields: IntakeField[];        // 35 entries
}

// types/evidence.ts (NEW)
type Channel = "browse" | "email" | "sms" | "call" | "form" | "calendar" | "inventory_file" | "pay";

interface SupplierEvidence {
  supplier_id: string;
  field_id: string;
  value: unknown;
  channel: Channel;
  evidence_id: string;          // pointer to source record (msg id, call id, scrape id)
  quote?: string;               // verbatim snippet
  confidence: "low" | "medium" | "high";
  timestamp: string;
}

// types/chain.ts (NEW)
type ChainStage = "form" | "call" | "email" | "sms_pay" | "meeting";
type ChainStageStatus = "locked" | "ready" | "in_progress" | "complete" | "failed" | "fallback";

interface ChainStageEvent {
  event_id: string;             // stable anchor (e.g. "stage-2-event-7"); referenced by SupplierEvidence.evidence_id when this event sources a field — enables provenance click-through from Filled Intake → timeline
  timestamp: string;
  direction: "outbound" | "inbound" | "system" | "reasoning";
  actor: "agent" | "supplier" | "buyer" | "stripe" | "cal" | "browser_use";
  channel?: Channel;
  text?: string;                // conversational / narration / reasoning content
  payload?: unknown;            // structured events: transfer details, ICS event, form field deltas
}

interface ChainState {
  run_id: string;
  supplier_id: string;          // "crovi_bio" for the demo
  stages: Record<ChainStage, {
    status: ChainStageStatus;
    started_at?: string;
    completed_at?: string;
    artifact_id?: string;       // pointer to: browser-use session, call sid, email id, sms id, stripe transfer id, calendar event id
    output?: unknown;           // stage-specific output (waitlist response, call transcript, email reply text, payment hash)
    events: ChainStageEvent[];  // bi-directional thread for this stage; rendered inline in chain timeline (Lineage view)
  }>;
  evidence_added: string[];     // evidence_id refs to SupplierEvidence pool (match against ChainStageEvent.event_id when that event sourced the evidence)
}

// types/supplier.ts (extended from existing)
interface SupplierCard {
  supplier_id: string;
  name: string;
  enrichment_mode: "browse" | "browse+xlsx" | "directory";  // crovi.bio is "directory"
  conviction: "high_match" | "worth_pursuing" | "long_shot" | null;
  conviction_reason: string;    // 1-line
  claimed: { conditions: string[]; sample_types: string[]; contact?: { email?: string; phone?: string; form_url?: string } };
  selected: boolean;            // multi-select state
}
```

---

## §4 The 5 demo beats — what's on screen

### Beat 1 — Upload

Landing page with two affordances: PDF dropzone (primary, demo path) + text query input (existing, kept for Q&A). Drop `Sample_Completed_Biospecimen_Request.pdf`.

```
┌──────────────────────────────────────────────────────────────┐
│  Crovi · Procurement Agent                                   │
│                                                              │
│      ┌────────────────────────────────────────────────────┐  │
│      │                                                    │  │
│      │     📄  Drop your intake PDF here                  │  │
│      │                                                    │  │
│      │       or paste a query — "NSCLC plasma, 100 cases" │  │
│      │                                                    │  │
│      └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Hash-detect the bundled sample → instant hand-authored extraction → IntakeForm populated, route to Beat 2. Any-other-PDF path uses `pdf-parse` + Claude Sonnet extractor as fallback.

### Beat 2 — Confirm

Top strip: 6 search-key fields as chips with inline edit. Below: collapsible "Full intake (35 fields)" showing all sections read-only. One CTA: `Launch enrichment →`.

```
┌──────────────────────────────────────────────────────────────┐
│  NovaCure × NSCLC Liquid Biopsy Validation Study             │
│                                                              │
│  ┌──────────┐ ┌────────────────┐ ┌───────────┐               │
│  │ INDICATION│ │ SPECIMEN TYPES │ │ QUANTITY  │               │
│  │ NSCLC     │ │ plasma + FFPE  │ │ 150 / 75  │               │
│  │ Stage III-│ │ + whole blood  │ │           │ ✏ edit       │
│  │ IV        │ │                │ │           │               │
│  └──────────┘ └────────────────┘ └───────────┘               │
│  ┌────────────┐ ┌──────────────┐ ┌───────────┐               │
│  │ BIOMARKER  │ │ TREATMENT    │ │ GEOGRAPHY │               │
│  │ EGFR / KRAS│ │ Naive        │ │ Domestic  │               │
│  │ / ALK      │ │ preferred    │ │ only      │               │
│  └────────────┘ └──────────────┘ └───────────┘               │
│                                                              │
│  ▸ Full intake (35 fields)                                   │
│                                                              │
│                                  [ Launch enrichment → ]     │
└──────────────────────────────────────────────────────────────┘
```

### Beat 3 — Enrich

Four cards land. Three real Browser Use sessions fire concurrently. Crovi.bio appears immediately from internal directory (no scrape). Right pane auto-opens RefMed's iframe so audience sees the first scrape live.

```
┌─ Suppliers (4) ──────────────────────┐  ┌─ Live: RefMed catalog ─────────┐
│                                      │  │                                │
│  ☐ 🇺🇸 Reference Medicine            │  │   [Live Chromium iframe]      │
│       ● High match                   │  │                                │
│       ● scraping catalog…  ▣        │  │   Navigating to /catalog       │
│       ● XLSX downloaded (14,637 rows)│  │   Found "NSCLC" section        │
│                                      │  │   Extracting case counts...    │
│  ☐ 🇺🇸 Geneticist Inc                │  │                                │
│       ● Worth pursuing               │  │   Found XLSX → downloading...  │
│       ● scraping About page…  ▣     │  │   → 14,637 rows parsed         │
│                                      │  │                                │
│  ☐ 🇺🇸 Audubon Bioscience            │  └────────────────────────────────┘
│       ● Worth pursuing               │
│       ● scanning forms portal…  ▣   │  Click any ▣ pip → switch iframe
│                                      │
│  ☐ 🌐 Crovi.bio                      │
│       ● Worth pursuing               │
│       ● Direct contact + form        │
│                                      │
│  [ Launch sequence on selected (0) ] │
└──────────────────────────────────────┘
```

Each scrape extracts 6-8 fields per supplier into SupplierEvidence pool. Conviction tier computed from coverage overlap with the 6 search-key fields. **Hard timeout per session** → flips to fallback (cached snapshot for that supplier; audience doesn't see broken iframe).

### Beat 4 — Launch

User checks crovi.bio's card → CTA enables → click `Launch sequence on selected (1) →`. Right pane swaps to the sequence template strip + chain timeline.

```
┌─ Agent sequence template ─────────────────────────────────────┐
│ ┌─FORM─┐    ┌─CALL─┐    ┌─EMAIL─┐    ┌─SMS+PAY─┐    ┌─MEET─┐ │
│ │ Fill │ →  │ Q&A  │ →  │ Quote │ →  │ $10 ↻   │ →  │ Book │ │
│ │ form │    │      │    │       │    │ Stripe  │    │ slot │ │
│ └──────┘    └──────┘    └───────┘    └─────────┘    └──────┘ │
│  Outreach              Confirmation         Contract & close  │
└───────────────────────────────────────────────────────────────┘
```

Stages render `ready / in_progress / complete / failed`. Lock breaks on each stage as it starts.

### Beat 5 — Chain runs

#### Stage 1: FORM

Right pane: Browser Use iframe navigates to crovi.bio's intake form. Each field types in from IntakeForm.fields. Pauses on `✋ Awaiting submit` overlay. User clicks `Submit on form` in our chrome → Browser Use clicks submit → response renders: **"Added to waitlist — capacity verification required."**

Planner reasoning streams: *"Waitlist outcome insufficient for SLA. Escalating to direct contact."*

#### Stage 2: CALL

Right pane: live call panel. AgentPhone dials crovi.bio number → **your phone rings on stage**. You answer playing the crovi.bio BD.

Voice agent reads from Supermemory (buyer spec context) → asks 3 substantive questions:

1. *"Can you confirm 150 plasma samples at minimum 2 mL, with matched FFPE blocks or 10 unstained slides, baseline pre-treatment?"*
2. *"What's your approximate breakdown across EGFR+, KRAS+, and ALK in your treatment-naive Stage III-IV NSCLC pool?"*
3. *"Do you ship de-identified only, with pathology reports and de-identified clinical history?"*

You answer roughly yes / yes with rates / yes plus SOPs. Live transcript streams. Agent closes: *"Thank you. I'll send the full specs and a benchmarked quote via email."* Supermemory writes the supplier answers as evidence.

**Fallback:** if no pickup by ring 4, secondary AgentPhone voice agent picks up, plays the same conversation scripted.

#### Stage 3: EMAIL

Right pane: outbound email panel. AgentMail sends to `bd@crovi.bio` with two attachments:

- **Filled Intake** (HTML preview rendered inline) — §1-6 with status badges, §7 partially computed, §8 pending.
- **Quote** (single page) — per-sample pricing + market benchmark + $10 down payment policy + validity window.

Email lands in the on-screen `bd@crovi.bio` inbox panel. You click `Reply: I agree` (one button, no typing). Reply webhook fires.

#### Stage 4: SMS + PAYMENT

Outbound SMS via AgentPhone to your phone: *"Crovi.bio contract drafted. Reply CONFIRMED to authorize $10 goodwill down payment via Stripe and lock allocation."*

You SMS back **"CONFIRMED — legally binding"**.

AgentPhone webhook fires → agent matches reply against authorization pattern → calls `stripe.transfers.create({ amount: 1000, destination: crovi_connect_account })` → Stripe webhook confirms settlement → push notification fires on your **Revolut** app.

In-app `Supplier Wallet` tile increments from $0 → $10 in real time (driven by Stripe webhook, not Revolut — guarantees climax fires even if Revolut push is delayed).

#### Stage 5: MEETING

Cal.com booking API creates an event on your real Google Calendar: *"Crovi.bio × NovaCure — Shipment logistics & contract review"*, next available slot. ICS arrives via AgentMail → confirmation evidence written.

#### Climax view

Right pane swaps to split:

```
┌─ Filled Intake (§1-8) ──────┐  ┌─ Quote ────────────────────┐
│ NovaCure × Crovi.bio        │  │ $213,750 total             │
│ 150 plasma + 75 FFPE/slides │  │ Plasma $850 · FFPE $1,150  │
│ All confirmable rows ✓      │  │ Market benchmark: -11%     │
│ §7 Feasibility: Confirmed   │  │ Down payment: $10 ✓ settled│
│ §8 Contract: Locked         │  │ Stripe txn: tr_xxx         │
└─────────────────────────────┘  └────────────────────────────┘

┌─ Evidence rail ─────────────────────────────────────────────┐
│  ✓ Meeting booked              ✓ $10 settled on Stripe rail │
│  ✓ Revolut push received     ✓ 5 sponsors live in chain     │
└─────────────────────────────────────────────────────────────┘
```

You hold up your phone showing the Revolut notification. Stage line:

> *"PDF intake to settled contract — four channels, one agent, real money moved. That's it."*

### Lineage view (mode toggle)

The right pane has two modes, toggled by a button in its header:

- **Climax mode** (default after Stage 5): Filled Intake §1-8 + Quote split-view as above.
- **Lineage mode**: chain timeline scrolled to top, all 5 stage cards expanded showing their full bi-directional threads (`ChainStageEvent[]` rendered with actor + channel + content + ordering).

Each stage's thread captures everything that happened during it. Example structure (rendered inline in the stage card):

```
[1] FORM                                                        ✓ complete
  · agent · browser_use  → navigated to crovi.bio/intake-demo
  · agent                → typed indication = "NSCLC III-IV"
  · agent                → typed quantity = "150 / 75"
  · ← form response: "Added to waitlist"
  · agent · reasoning    : Waitlist insufficient. Escalating to voice.

[2] CALL                                                        ✓ complete
  · agent  → dialed crovi.bio BD line
  · ← supplier (you): "Hello, crovi.bio BD."
  · agent: "Can you confirm 150 plasma at minimum 2 mL..."
  · ← supplier: "Yes — about 12% of our naive cases are EGFR+"   [event-7]
  ...

[3] EMAIL                                                       ✓ complete
  · agent  → sent to bd@crovi.bio (2 attachments)
  · ← supplier reply: "I agree."

[4] SMS + PAY                                                   ✓ complete
  · agent       → SMS: "Reply CONFIRMED to authorize $10..."
  · ← buyer (you): "CONFIRMED - legally binding"
  · stripe      · transfers.create($10) → tr_xxx
  · stripe      · webhook: succeeded
  · revolut     · push notification fired

[5] MEETING                                                     ✓ complete
  · cal         · createEvent → evt_xxx
  · ← ICS receipt landed via AgentMail
```

Every event has a stable `event_id` anchor. Each confirmable/updatable field on the Filled Intake has a provenance hovercard with `channel + actor + quote`; clicking the pill **auto-toggles to lineage mode and scrolls the timeline to the source event anchor**. Audience moment: *"Where did 'EGFR rate ≈ 12%' come from?"* → click pill → timeline scrolls to Stage 2, event-7, the supplier's answer turn. Every field in the Filled Intake is traceable to a verbatim moment in the lineage.

After narration ends, you toggle back to climax mode for the close.

---

## §5 Sponsor wiring

| Sponsor | Lives in | API surface |
|---|---|---|
| **AgentMail** | Enrichment-to-evidence webhook + Stage 3 email send + Stage 5 ICS receipt + reply-yes webhook | `inboxes.create`, `messages.send` with attachments, inbound webhook |
| **Browser Use** | Enrichment ×3 concurrent + Stage 1 form fill (×1) | Cloud sessions, `live_view_url`, completion webhook |
| **AgentPhone** | Stage 2 outbound voice + voice agent persona + Stage 4 outbound SMS + inbound SMS webhook for authorization | `calls.create`, voice agent config, `sms.send`, inbound webhooks |
| **Stripe** | Stage 4 down-payment transfer | Connect account creation, `transfers.create`, payout to Revolut, settlement webhook |
| **Supermemory** | Voice agent memory: pre-call buyer spec load + per-turn retrieval + post-call evidence store | `add`, `search`, `update` |
| **Sponge** | (Swap-in option for payment rail) | TBD |
| Moss / Google DeepMind | — | — |

---

## §6 Build verticals

### F1-F5 Foundation

| # | What |
|---|---|
| F1 | `types/intake.ts` + `types/evidence.ts` + `types/chain.ts` (schemas above) |
| F2 | `lib/intake/categorize.ts` — applies field-class table to a parsed intake; computes status from evidence pool projections |
| F3 | `lib/intake/sample-extractor.ts` — hash-detect bundled PDF → return hand-authored extraction. LLM fallback via existing `app/api/parse/route.ts` |
| F4 | `store/runs/{runId}/intake.json` + `evidence.jsonl` + `chain.json` writers |
| F5 | `lib/agents/runtime/chain-runtime.ts` — 5-stage state machine: stage_complete + outcome → next_stage_unlock; handles fallback transitions |

**Stop after F5: smoke test that IntakeForm fixture → categorize → status badges render in a sandbox page. Commit.**

### V1 — Enrichment phase

| # | What |
|---|---|
| V1.1 | `lib/integrations/browser-use.ts` — expose `live_view_url`, status polling, hard timeout per session |
| V1.2 | `lib/agents/enrich.ts` — orchestrates 3 concurrent sessions; defines extraction targets per supplier (8 fields each); writes to evidence pool |
| V1.3 | RefMed XLSX: load from local file via existing `lib/search/refmed-loader.ts` and populate evidence pool; render in card body. *(No live download — trade-off is losing the "agent fetched a file" theater.)* |
| V1.4 | `components/Enrich/SupplierCardsGrid.tsx` (NEW) — 4 cards, conviction chips, ▣ pip per session, checkbox multi-select |
| V1.5 | `components/Enrich/ChromiumIframe.tsx` (NEW) — live iframe with action log overlay; switcher for which supplier's session is shown |

**Stop after V1.5: hardcoded intake → 4 cards appear → 3 iframes go live → conviction tiers compute. Commit.**

### V2 — PDF intake + Confirmation top-strip

| # | What |
|---|---|
| V2.1 | `components/Intake/Dropzone.tsx` (NEW) — replaces existing LandingForm primary surface; PDF drop + paste-text fallback |
| V2.2 | `app/api/intake/route.ts` (NEW) — accepts PDF upload, hashes, dispatches to sample-extractor or LLM fallback |
| V2.3 | `components/Intake/ConfirmStrip.tsx` (NEW) — 6 search-key chips with inline edit; uses existing `Clarifiers` component for ambiguity prompts |
| V2.4 | `components/Intake/FullIntakeAccordion.tsx` (NEW) — collapsible full 35-field view |

**Stop after V2.4: full Beat 1 → Beat 2 → Beat 3 transition works on sample PDF. Commit.**

### V3 — Sequence template strip + chain timeline UI

| # | What |
|---|---|
| V3.1 | `components/Chain/SequenceTemplate.tsx` (NEW) — 5-stage horizontal strip with lock/ready/in_progress/complete state styling |
| V3.2 | `components/Chain/Timeline.tsx` (NEW) — vertical stack of stage cards; each card renders a **bi-directional thread** of `ChainStageEvent[]` (outbound / inbound / system / reasoning) with actor + channel icons + stable anchor IDs per event. Stage-specific embedded artifacts (iframe / call panel / inbox panel / SMS panel / wallet tile / calendar tile) anchor inline inside the thread. Reuses patterns from existing `components/ChatRail/EventLog.tsx` + `components/Running/RunningView.tsx`. |

### V4 — 5-stage chain wiring

| # | What |
|---|---|
| V4.1 | `lib/integrations/agentphone.ts` (NEW) — call out, SMS out, inbound webhooks for both |
| V4.2 | `lib/agents/voice-persona.ts` (NEW) — Sonnet-backed voice agent system prompt + 3-question script + outcome parser |
| V4.3 | `app/api/webhooks/agentphone/route.ts` (NEW) — inbound SMS parsing (matches "CONFIRMED" pattern → triggers payment) + call completion webhook |
| V4.4 | `lib/agents/runtime/chain-runtime.ts` extensions — stage transitions wired to integration callbacks |
| V4.5 | Cal.com booking via API (existing googleapis or direct Cal.com REST); ICS receipt via AgentMail → chain.meeting completion |

### V5 — Stripe + Revolut surface

| # | What |
|---|---|
| V5.1 | `lib/integrations/stripe.ts` (NEW) — Connect account ref + transfers.create + webhook handler |
| V5.2 | `components/Chain/WalletTile.tsx` (NEW) — supplier wallet balance tile; updates via Stripe webhook (not Revolut) |

### V6 — Filled Intake + Quote renderers

| # | What |
|---|---|
| V6.1 | `components/Output/FilledIntake.tsx` (NEW) — renders §1-8 with status badges; each confirmable/updatable field has a provenance hovercard that **clicks through to the matching `ChainStageEvent` anchor** in the chain timeline (uses `evidence_id` as the anchor target, auto-toggles right pane to lineage mode). |
| V6.2 | `components/Output/Quote.tsx` (NEW) — single-page quote with per-sample pricing, market benchmark band, down-payment policy, validity |
| V6.3 | `lib/intake/section7.ts` + `section8.ts` — pure functions computing those sections from current evidence pool + ChainState |
| V6.4 | **Climax ↔ Lineage toggle**: button in right-pane header swapping climax split-view with expanded chain timeline scrolled to top. Provenance click-throughs auto-toggle to lineage and scroll to anchor. |

### V7 — Supermemory + polish + fallbacks

| # | What |
|---|---|
| V7.1 | `lib/integrations/supermemory.ts` (NEW) — add / search; called pre-call (load buyer spec) + per-turn (retrieve question target) + post-call (write evidence) |
| V7.2 | Phone-no-pickup fallback voice agent (Stage 2) — same persona, scripted |
| V7.3 | Stripe-payment-fail fallback — wallet tile fires from a manual button if webhook hangs |
| V7.4 | Cached snapshot fallback for Browser Use timeout (Stage 1 + Enrichment) |

---

## §7 What's CUT from existing softening-arc spec

These are intentionally not built. If implementation drift introduces them, push back.

- **AI Elements F0 migration** (Tailwind 4 + shadcn + `@ai-elements/*`). Keep existing CSS. Hand-roll the new components in plain React + the project's existing tokens.
- **Chat-driven planner override path** (V4.4-V4.5 of existing spec). The chain is autonomous + user-gated; no live "skip X, push Y" override needed.
- **Per-supplier action matrix** on cards. Replaced by sequence template strip (single template, multi-select supplier).
- **Comms to non-crovi suppliers.** RefMed/Geneticist/Audubon are scrape-only. Never send them email/SMS/calls.
- **crovi.bio dashed indigo meta chrome.** It's a normal card.
- **Sourcing vs Confirming taxonomy fields** on each YAML action (`mode: sourcing|confirming`, `fills_categories: []`). The chain has its own state; per-action taxonomy is unused.
- **`/api/demo/reset`.** Manual delete of `store/runs/{runId}/` between rehearsals.
- **Phase B stretch** (SMS + voice for other suppliers). Not in scope.
- **The `Conversation` / `Plan` / `Tool` / `Confirmation` / `Queue` AI Elements primitive map** (spec §5.4). Replaced by plain React components above.
- **The 4-state softening arc pip color language** (Indirect/Contacted/Categorized/Confirmed). Replaced by conviction tier chips (high/worth/long-shot) + per-stage status (ready/in_progress/complete/failed).

---

## §8 File plan

### NEW files (created from scratch)

```
types/intake.ts
types/evidence.ts
types/chain.ts
lib/intake/categorize.ts
lib/intake/sample-extractor.ts
lib/intake/section7.ts
lib/intake/section8.ts
lib/agents/enrich.ts
lib/agents/voice-persona.ts
lib/agents/runtime/chain-runtime.ts
lib/integrations/agentphone.ts
lib/integrations/stripe.ts
lib/integrations/supermemory.ts
app/api/intake/route.ts
app/api/webhooks/agentphone/route.ts
app/api/webhooks/stripe/route.ts
components/Intake/Dropzone.tsx
components/Intake/ConfirmStrip.tsx
components/Intake/FullIntakeAccordion.tsx
components/Enrich/SupplierCardsGrid.tsx
components/Enrich/ChromiumIframe.tsx
components/Chain/SequenceTemplate.tsx
components/Chain/Timeline.tsx
components/Chain/WalletTile.tsx
components/Output/FilledIntake.tsx
components/Output/Quote.tsx
store/runs/{runId}/intake.json        (runtime artifact)
store/runs/{runId}/evidence.jsonl     (runtime artifact)
store/runs/{runId}/chain.json         (runtime artifact)
```

### EDITED files

```
app/page.tsx                          — landing now leads with Dropzone
app/workspace/page.tsx                — collapses parse+clarify into ConfirmStrip; routes to Enrich → Chain phases
app/api/parse/route.ts                — accepts PDF via sample-extractor fallback path
lib/integrations/browser-use.ts       — exposes live_view_url, hard per-session timeout
lib/integrations/agentmail.ts         — extends to support 2-attachment email send + ICS receipt
lib/search/refmed-loader.ts           — wired into enrich.ts second-act
lib/demo-suppliers.ts                 — surfaces 4 cards (3 real + crovi.bio) with conviction tier logic
```

### CUT / un-referenced (existing-spec direction)

```
docs/superpowers/specs/softening-arc-spec.md  — superseded by this doc (keep for history, do not implement)
lib/agents/action-spaces/*.yaml       — leave but do NOT extend with mode/fills_categories fields
components/Channels/*                 — referenced in existing spec; do not build new files there
hooks/useRunChat.ts                   — do not build
app/api/chat/[runId]/route.ts         — do not build
```

---

## §9 Demo runbook — click-by-click

| Step | Action | Visible on screen |
|---|---|---|
| 1 | Open `/`, drop sample PDF into dropzone | "Reading your intake…" |
| 2 | ConfirmStrip lands with 6 chips populated | NSCLC / plasma+FFPE+blood / 150-75 / EGFR-KRAS-ALK / naive / domestic |
| 3 | Click `Launch enrichment →` | Routes to Enrich phase |
| 4 | 4 cards land. Crovi.bio instant. RefMed/Geneticist/Audubon show "scraping…" pip. Right pane auto-opens RefMed iframe | Live Chromium navigates RefMed catalog |
| 5 | RefMed XLSX downloads + parses. Card body fills with 14,637 cases | "High match" chip + sample-type breakdown |
| 6 | Geneticist + Audubon iframes complete | All 4 cards in final state |
| 7 | Check crovi.bio checkbox | CTA enables: `Launch sequence on selected (1) →` |
| 8 | Click CTA | Right pane swaps to sequence template + chain timeline |
| 9 | Stage 1 (Form) starts | Browser Use iframe navigates to crovi.bio intake form, types every field |
| 10 | "✋ Awaiting submit" overlay | Click "Submit on form" |
| 11 | Form submits → waitlist response | Card: `WAITLISTED`. Reasoning streams: "Escalating to voice." |
| 12 | Stage 2 (Call) starts. AgentPhone dials | **Your phone rings.** Answer. |
| 13 | Voice agent asks Q1 (specimen + format) | Live transcript streams |
| 14 | Q2 (biomarker subsets), Q3 (de-id + path reports) | Live transcript |
| 15 | Agent: "I'll send specs and quote via email." Hangup | Card: call ✓ |
| 16 | Stage 3 (Email) sends to bd@crovi.bio | Inbox panel shows email with 2 attachments |
| 17 | Open Filled Intake attachment inline | §1-6 with status badges visible |
| 18 | Open Quote attachment inline | $213,750 with -11% benchmark band |
| 19 | Click `Reply: I agree` | Reply sends |
| 20 | Stage 4 (SMS+Pay) — SMS arrives on your phone | "Reply CONFIRMED to authorize $10 down payment…" |
| 21 | SMS back "CONFIRMED — legally binding" | Agent parses → calls Stripe |
| 22 | Stripe webhook fires → wallet tile +$10 | **Your Revolut buzzes** — hold up phone |
| 23 | Stage 5 (Meeting) — Cal.com creates event | Calendar invite tile appears |
| 24 | Switch to Google Calendar tab briefly | Invite visible on real calendar |
| 25 | Right pane swaps to climax split view | Filled Intake (§1-8) + Quote side-by-side |
| 26 | Hover a Filled Intake field → click its provenance pill | Right pane auto-toggles to **Lineage view** + scrolls to the source `ChainStageEvent` (e.g., "EGFR rate" → Stage 2 Call, event-7) |
| 27 | Toggle back to climax view | Filled Intake + Quote again, then stage line + CTA |
| 28 | Stage line + CTA: "PDF intake to settled contract — that's it." | crovi.bio/early-access |

**If Beat 3 enrichment runs slow, skip directly to Beat 4 with two suppliers' iframes mid-flight — they finish during chain stage 1.**

---

## §10 Acceptance checklist

A demo run passes if ALL pass:

- [ ] PDF dropzone accepts the bundled sample → IntakeForm renders 35 fields
- [ ] ConfirmStrip top strip shows 6 search-key chips with editable inline values
- [ ] `Launch enrichment →` routes to Beat 3 with 4 supplier cards
- [ ] 3 real concurrent Browser Use sessions visible via live iframes; RefMed XLSX downloads + parses; cards land with conviction tiers
- [ ] Multi-select checkbox UX works; crovi.bio selectable; CTA enables
- [ ] Sequence template strip + chain timeline render on launch
- [ ] Stage 1 form fill is live in iframe; user-gated submit; waitlist outcome lands
- [ ] Stage 2 voice call dials your phone; voice agent asks all 3 substantive questions; transcript streams
- [ ] Stage 3 email lands with 2 attachments; Filled Intake + Quote previews open inline; reply button works
- [ ] Stage 4 SMS lands on your phone; reply-CONFIRMED triggers Stripe transfer; wallet tile increments; Revolut push arrives
- [ ] Stage 5 calendar invite lands on real Google Calendar
- [ ] Climax view renders Filled Intake §1-8 + Quote side-by-side; all status badges show provenance
- [ ] Each chain stage card shows its full **bi-directional thread** (outbound + inbound + reasoning events) in the chain timeline
- [ ] **Climax ↔ Lineage toggle** button swaps right pane between docs split-view and expanded timeline
- [ ] **Clicking a provenance pill** on Filled Intake auto-toggles to Lineage view and scrolls to the matching `ChainStageEvent` anchor
- [ ] All 5 sponsor APIs (AgentMail, Browser Use, AgentPhone, Stripe, Supermemory) fire live during the demo
- [ ] Phone-no-pickup fallback at Stage 2 works (test by ignoring the ring)
- [ ] Stripe-fail fallback at Stage 4 (manual wallet-tile increment button) works
- [ ] Browser-Use timeout fallback works (test by killing a session mid-flight)

---

## §11 Pre-flight de-risking — DO BEFORE WRITING CODE

These are sequencing risks. Each is a short smoke test against the real API/service. **Do all in Block A before starting any vertical.** If any fails, escalate before sinking build effort on top.

### Block A — Integration smoke tests

1. **Browser Use** — sign up, get API key. Spin up one session pointed at `https://referencemedicine.com`. Confirm `live_view_url` is returned and renders in an `<iframe>` without CSP block. Confirm concurrent 3-session execution doesn't error. **Outcome needed:** API key + iframe-able URL confirmed + 3-concurrency confirmed.
2. **AgentMail** — sign up, create inbox `bd@crovi.bio` (or vendor-default domain if crovi.bio not provisionable yet). Send a 2-attachment email from API. Reply from inbox via webhook. **Outcome needed:** webhook endpoint URL works locally via ngrok or Vercel tunnel; attachments survive round-trip.
3. **AgentPhone** — sign up, provision 1 phone number, place test outbound call. Test voice agent persona — what's their voice model? Does it stream transcripts? Send + receive an SMS. **Outcome needed:** call lands on your real phone; SMS round-trip works; transcript streams via webhook.
4. **Stripe** — Connect account creation for crovi.bio destination. Run a $0.50 test transfer. Confirm payout-to-Revolut works (or if not, confirm payout to your bank with same notification surface). **Outcome needed:** transfer succeeds in test mode; webhook fires; settlement flows to Revolut or fallback. **CRITICAL: Test-mode payouts do NOT trigger Revolut push.** Use live mode with very small amounts ($0.50-$1) for the actual demo dry-run.
5. **Supermemory** — sign up, hit `add` + `search` against their REST API. Confirm latency is low enough not to stall the voice loop. **Outcome needed:** API key + functional add/search round-trip.
6. **Cal.com or Google Calendar** — pick one. If Cal.com: API key + 1 scheduling page. If Google Calendar: OAuth + Calendar API quota. Create one test event programmatically and confirm it lands on your real calendar. **Outcome needed:** event creation API works end-to-end.
7. **Revolut payout latency** — Stripe-to-Revolut transfer latency in production. Some currencies/connections are near-instant; others are deferred. **CRITICAL.** If it's not fast enough to land on stage, switch the climax to wallet-tile-only (Revolut push as bonus, not as climax).

### Block B — Content prep

8. **Crovi.bio JotForm/Typeform** — create the form mimicking a biobank intake. Configure it to return "Added to waitlist" response on submit. Host at a public URL Browser Use can navigate to.
9. **3 supplier scrape targets — confirm reachable and parsable:**
   - RefMed: catalog URL accessible; XLSX download link selector identified
   - Geneticist: About page selectors; conditions list extractable
   - Audubon: form portal accessible; form list extractable
10. **Bundled sample PDF** — hash it; bake the hash + hand-authored field mapping into `lib/intake/sample-extractor.ts`. No real PDF parsing on the demo path.
11. **Voice agent persona prompt** — write the system prompt: opening line, 3 substantive questions, closing line, hangup. ~15 lines.
12. **Quote document content** — finalize pricing ($850/$1,150/$700) + market benchmark numbers ($950 median, n=18) + down-payment policy ($10 goodwill).

### Block C — Stage rehearsal (before submission)

13. **End-to-end dry run twice.** Time it. Identify the slowest stage. Pre-warm Browser Use sessions if possible.
14. **Backup laptop with the same env vars.** If primary hangs mid-demo, switch screens.
15. **Power + cellular check.** Your phone must have signal for AgentPhone SMS/voice + Revolut push.

### Sponge swap decision point

If Sponge has agent-native `createTransfer(wallet, wallet, amount)` with webhook and a quick onboarding, **swap Stripe → Sponge** in `lib/integrations/`. Same architecture, contained swap. If their API is checkout-link-based or their docs are missing, **stay on Stripe.** No regret either way.

---

## §12 Services / accounts to set up (PARALLEL)

These are independent. Set up all 13 in any order. Some are one-time (account creation); some are configuration (numbers, forms, calendars).

| # | Service | What to do | Output needed |
|---|---|---|---|
| 1 | **AgentMail** | Sign up. Create inbox `bd@crovi.bio` (or vendor default). Get API key + webhook URL config | API key, inbox address, webhook URL |
| 2 | **Browser Use** | Sign up. Confirm 3-session concurrency on the plan. Get API key. Test iframe-ability of `live_view_url` | API key, plan confirmed |
| 3 | **AgentPhone** | Sign up. Provision 1 phone number (used as crovi.bio's BD line for outbound). Configure voice agent: voice model, persona prompt, transcript webhook. Configure SMS inbound webhook | API key, phone number, voice agent ID, webhooks configured |
| 4 | **Stripe Connect** | Sign up if not already. Create Connect account for crovi.bio destination. Connect to Revolut via Stripe payout. Get API key + webhook secret | API key, Connect account ID, webhook secret |
| 5 | **Supermemory** | Sign up. Get API key. Test add/search | API key |
| 6 | **Sponge** *(optional swap-in)* | Sign up. Test transfer primitive. Decide swap before stage rehearsal | API key (if swapping) |
| 7 | **Cal.com** *(or Google Calendar)* | Sign up. Create 1 scheduling page for crovi.bio. Configure webhook on booking confirm. Connect to your Google Calendar so events land there | API key, scheduling page URL |
| 8 | **JotForm / Typeform on crovi.bio** | Create form mimicking biobank intake (15-20 fields). Configure waitlist response. Host at public URL. Confirm Browser Use can navigate it | Public form URL |
| 9 | **crovi.bio domain** | Verify domain ownership. Configure DNS for AgentMail inbox (`bd@crovi.bio` MX), form hosting (subpath or subdomain) | DNS configured |
| 10 | **NovaCure persona email** | Use AgentMail OR a Gmail inbox you control. This is where the agent will email NovaCure the filled intake + quote in Stage 3-equivalent (note: the Stage 3 email goes TO bd@crovi.bio, but optionally a parallel send to NovaCure could close the loop) | Inbox address |
| 11 | **Your phone** | Confirm signal at venue. Confirm Revolut push notifications enabled. Confirm SMS receiving works. Charged + on the table during demo | Confirmed |
| 12 | **Revolut account** | Confirm balance is non-zero or you've received at least one prior push so the system is "warm." Confirm push notifications enabled at the OS level | Confirmed |
| 13 | **OPENAI_API_KEY / ANTHROPIC_API_KEY** | Confirm current keys in `.env.local` work. Check rate limits / billing balance | Keys valid |

**Run setup in parallel across people or in idle moments while waiting on the integration tests.**

### Env vars summary (add to `.env.local`)

```
AGENTMAIL_API_KEY=
AGENTMAIL_INBOX_BD_CROVI=bd@crovi.bio
AGENTMAIL_WEBHOOK_SECRET=

BROWSER_USE_API_KEY=

AGENTPHONE_API_KEY=
AGENTPHONE_PHONE_NUMBER=+1...
AGENTPHONE_VOICE_AGENT_ID=
AGENTPHONE_WEBHOOK_SECRET=

STRIPE_SECRET_KEY=
STRIPE_CONNECT_DESTINATION=acct_...
STRIPE_WEBHOOK_SECRET=

SUPERMEMORY_API_KEY=

CALCOM_API_KEY=
CALCOM_SCHEDULING_PAGE_URL=

CROVI_INTAKE_FORM_URL=https://crovi.bio/intake-demo
NOVACURE_BUYER_EMAIL=

NEXT_PUBLIC_DEMO_SUPPLIER_ID=crovi_bio
```

---

## §13 Order of attack

Recommended sequencing — phases run in order; verticals inside a phase can parallelize.

**Phase 1 — Setup + de-risk (no code yet)**
- Block A (smoke tests) + Block B (content prep) + § 12 (services) — all 13 services in parallel.
- End state: every API key is in `.env.local`, every integration has been hit once successfully.

**Phase 2 — Foundation + V2 (intake)**
- F1-F5: schemas + sample extractor + chain runtime skeleton.
- V2: PDF dropzone + Confirm strip. Stop when "drop sample → ConfirmStrip" works.

**Phase 3 — V1 enrichment + V3 chain UI shells**
- V1: 3 Browser Use sessions + cards + iframe switcher. Cut RefMed second-act if behind.
- V3: sequence template + timeline UI shells.

**Phase 4 — V4 chain wiring + V5 payment**
- V4: AgentPhone integration + voice persona + chain stage transitions + Cal.com.
- V5: Stripe + Wallet tile.

**Phase 5 — V6 docs + V7 polish + rehearsal**
- V6: Filled Intake + Quote renderers + §7/§8 logic.
- V7: Supermemory + fallbacks.
- Block C: two dry runs.

**Phase 6 — Submission buffer.** Reserve buffer for unforeseen breakage before submitting.

---

## §14 Hard rules during implementation

1. **No AI Elements migration.** Hand-roll in existing CSS. If you find yourself running `npx ai-elements@latest add`, stop.
2. **Crovi.bio only sends comms.** Never `messages.send` to refmed/geneticist/audubon addresses. Hard guard in `lib/integrations/agentmail.ts`.
3. **No new abstractions for Sourcing vs Confirming.** The chain has its own state. Per-action taxonomy fields are unused.
4. **PDF extraction is hash-fastpath FIRST.** Never demo the LLM fallback path.
5. **Cut the second-act XLSX download if Block A reveals Browser Use latency is unsafe for the demo.** Use the existing `lib/search/refmed-loader.ts` from a local file path instead.
6. **Stripe live mode for the demo run.** Test mode does not trigger Revolut push. Run a $0.50 live dry-run before stage, then $10 on stage.
7. **If any sponsor API fails Block A smoke test, drop that sponsor from the chain immediately.** Don't sink time fixing onsite. Falling to 4 sponsors is fine.

---

End of spec. Implementation can start now.
