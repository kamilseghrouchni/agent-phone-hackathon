# Browser Use

One-line: Open-source library plus hosted cloud that drives a real Chromium session from a natural-language task, so an LLM can browse, click, fill forms, and download files on live sites.

## What it gives us

- Real Chromium driven by an LLM. You write `Agent(task="...", llm=...)`, the agent observes the DOM and acts.
- Persistent profiles. Log in once, profile stores cookies + localStorage + saved passwords, reuse across runs.
- Human-in-the-loop. Open the live browser, finish a 2FA or CAPTCHA step by hand, then hand control back to the agent with a follow-up task.
- Stealth + residential proxies in 195+ countries, built-in CAPTCHA solving on cloud.
- File downloads land in a workspace. Pull them out with `workspaces.download(id, "inventory.csv")` or `download_all`.
- Structured output. Pass a Pydantic (Python) or Zod v4 (TS) schema, get `result.output` typed.
- Two modes: Agent mode (`sessions.create` / `run`) and Browser mode (`browsers.create`, raw CDP).
- Domain allowlist + `sensitive_data` parameter so the LLM never sees the raw credential string.
- Live preview, session recording, webhooks, deterministic rerun, MCP server, n8n node.

## API surface

OSS library (Python, self-hosted):

- `pip install browser-use`
- `Agent(task=..., llm=ChatBrowserUse() | ChatAnthropic() | ChatOpenAI() | Gemini | Ollama, browser=...)`
- Reuse local Chrome profile path for saved logins.
- LangChain integration, custom tools, structured output via Pydantic.

Cloud SDK (Python + TypeScript):

- `pip install browser-use-sdk` / `npm install browser-use-sdk`
- Auth: `BROWSER_USE_API_KEY` env var, key from `cloud.browser-use.com/settings`.
- One-shot: `client.run(task="...")`.
- Session-scoped: `client.sessions.create(profile_id=...)` then `client.tasks.create(session_id, task=...)` then follow-ups.
- Files: `client.workspaces.download(workspace_id, path, to=...)`.
- Profiles: create per end-user, store profile_id in our DB, reuse for subsequent runs.
- REST host: `api.browser-use.com` (v3, v2 legacy).

Constraints: session timeout 15 min idle, 4 h hard cap. Send `task="wait"` to keep alive.

## Pricing & limits

- Free tier: no credit card, 3 concurrent sessions.
- Dev: $29/mo. Business: $299/mo (~$400 credits with bonus). Scaleup: up to 500 concurrent sessions. Enterprise: custom.
- Usage on top: $0.06/browser-hour, $5/GB proxy bandwidth, LLM tokens billed separately (or BYO key on Business+).
- Hackathon credits: not documented publicly — ask sponsor at kickoff. They host their own "Browser Use Web Agents Hackathon" series, so credits for Call My Agent are plausible.

## What we can build with it for vCRO

Mapping to the External tab on `referencemedicine.com` and other supplier portals:

1. Live inventory lookup. Agent navigates to RM's portal, filters by indication + stage + biomarker (e.g. "NSCLC III-IV, EGFR+"), captures matching case IDs with prices into a Pydantic `Case[]` schema. No more stale May Excel.
2. CSV pull. If RM exposes a "download inventory" button, agent clicks it; we pull the file out of the workspace, parse it server-side, merge with the intake-form criteria.
3. Quote-request fan-out. One profile per supplier (RM, Discovery Life Sciences, BioIVT, iSpecimen). Agent fills each supplier's quote form with the same intake payload, screenshots the submission, returns confirmation IDs.
4. Login wall handling. First run is human-in-the-loop: ops person logs into RM portal once in the live preview, profile saves cookies. Every later run is headless.
5. Feed back to `answer.json`. Structured output goes straight into the AvailabilityClaim shape the External tab already renders, so the same UI shows "150 cases @ $X tier, live as of <timestamp>" instead of a stale snapshot.

## Open questions

- Hackathon credits: amount, how to redeem, valid window.
- Does RM's portal actually expose programmatic search/download, or only email intake? Affects whether step 1 or step 3 is the demo.
- 2FA pattern on supplier portals — does HITL handoff work for SMS codes, or only for app-based auth?
- Rate limits per cloud account during the event (we'll fan out to 4+ portals in parallel).
- Latency: a 3-step form fill seems to take 30–60 s; need parallel sessions to stay under demo time.
- Can we ship a profile from local dev (logged in) up to cloud, or must we re-login in cloud preview?

## Links

- https://browser-use.com
- https://docs.browser-use.com
- https://docs.browser-use.com/cloud/quickstart
- https://docs.browser-use.com/cloud/guides/authentication
- https://docs.browser-use.com/cloud/agent/structured-output
- https://docs.browser-use.com/cloud/agent/human-in-the-loop
- https://www.ycombinator.com/companies/browser-use
- https://events.ycombinator.com/browser-use-hackathon
- https://cloud.browser-use.com
