# agent-phone-hackathon

**YC Call My Agent Hackathon — San Francisco**

A live-on-stage demo: an agent closes a biospecimen procurement contract end-to-end, from a buyer's PDF intake to a settled payment + calendar invite. Five sponsors fire live in one chain: **AgentMail · Browser Use · AgentPhone · Stripe · Supermemory**.

## The five beats

1. **Upload** — drop NovaCure's biospecimen procurement PDF → agent extracts 35 fields into an `IntakeForm`.
2. **Confirm** — top-strip shows the 6 search-key fields with inline edit; full 35-field intake collapsible.
3. **Enrich** — 3 concurrent Browser Use sessions scrape RefMed (+XLSX), Geneticist, Audubon, each with a clickable Chromium iframe. Crovi.bio appears as a 4th card from internal directory. Conviction tiers computed live.
4. **Launch** — multi-select supplier cards → pick Crovi.bio → sequence template strip reveals the 5-stage chain.
5. **Chain** — Form (waitlist) → Call (3 questions, your phone rings) → Email + Quote → SMS (you authorize "$10") → Stripe transfer ($10 lands in Revolut) → Calendar invite. Filled Intake §1-8 + Quote shown side-by-side as climax.

## Repo layout

- [`SPEC.md`](./SPEC.md) — **implementation truth.** Architecture, schemas, the 35-field intake categorization, build verticals (F1-V7), file plan, demo runbook, pre-flight de-risking, services checklist, env vars, order of attack, hard rules.

Start in `SPEC.md` §11 (pre-flight de-risking) and §12 (services to set up) before writing any code.
