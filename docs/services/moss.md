# Moss

One-line: in-process semantic search runtime (Rust + WASM) that returns top-k matches in <10 ms so voice agents can retrieve mid-sentence without a pause.

YC F25. Founders: Sri Raghu Malireddi (ex-Grammarly ML), Harsha Nalluru (ex-Microsoft). Site: moss.dev. Docs: docs.moss.dev.

## What it gives us

- Sub-10 ms top-k lookup once the index is loaded into the agent process (local-first; cloud fallback ~100–500 ms).
- Hybrid search in one call: `alpha=1.0` semantic, `alpha=0.0` keyword, blend in between.
- Metadata filters: `$eq`, `$and`, `$in`, `$near`.
- Built-in embedding models (no separate embedding API key). BYO embeddings supported.
- Multiple indexes per project — one index per supplier is natural.
- Pipecat plugin as a pipeline stage between STT and LLM — retrieval happens before the LLM sees the turn, no tool-call round-trip.
- LiveKit, Pipecat, Vapi, ElevenLabs, Agora listed as voice integrations. AgentPhone not listed.
- Replaces the vector-DB leg for voice (Pinecone / pgvector / LanceDB) — Moss is the index runtime, not a layer on top of one.

## API surface

- Python: `pip install moss` and `pip install pipecat-moss`.
- JS/TS: `npm install @moss-dev/moss`; browser build `@moss-dev/moss-web` (WASM).
- Auth: `MOSS_PROJECT_ID` + `MOSS_PROJECT_KEY` from portal.usemoss.dev.
- REST control plane: `https://service.usemoss.dev/v1` (create / delete / status; SDK wraps it).
- SDK methods: `create_index`, `add_docs`, `delete_docs`, `load_index`, `query(index, text, QueryOptions(top_k, alpha, filter))`.
- Pipecat shape: `MossRetrievalService(project_id, project_key)` → `moss_service.query(index, top_k=5, alpha=0.8)` sits between `context_aggregator.user()` and `llm` in the Pipeline.
- Document shape: `{id, text, metadata?}`.

## Pricing & limits

- Developer: free, $5/mo credits, unlimited local queries, shared infra.
- Hobbyist: $30/mo + usage. Continuous sync, unlimited projects/indexes, file upload.
- Start-up: $200/mo + usage. Hot-path cloud search, 150 concurrent sessions, priority ingest.
- Enterprise: contact. SOC2, HIPAA, SSO, 99.9% SLA.
- Latency claim: <10 ms after `load_index`. No public p50/p99 split.
- Document/index size caps: not published.
- Hackathon credits: not advertised — ask sponsor at kickoff.

## What we can build with it for vCRO

- Push the 14k-row Reference Medicine inventory once (`add_docs`, one row per doc, metadata = `{tier, fee, rm_case_id, tumor_site, diagnosis, T, N, M, treatment_status, supplier}`). Index name: `rm-inventory`.
- One Moss index per supplier (`rm-inventory`, `discovery-life-sciences`, `bioivt`, ...) so the agent scopes search to the supplier it is calling.
- During the call, Pipecat pipeline: STT → Moss query on the user's last utterance with `alpha=0.7` → LLM sees the top-5 matches injected as context → TTS. The BD contact hears the answer without the "pause while we look it up".
- Metadata filter for hard constraints the LLM extracts pre-query: `{tumor_site: "NSCLC", T: {$in: ["T3","T4"]}, treatment_status: "naive"}` then semantic over the free-text diagnosis field for soft match (EGFR+, FFPE+plasma matched).
- Live re-rank: when the BD contact narrows ("only Stage III, not IV"), re-query with updated filter — re-query cost is sub-10 ms so the agent can refine in dialogue instead of after the call.

## Open questions

- Hard p99 number under voice load (not just p50 hot path).
- Does the Python SDK run the index in-process on the agent host, or is "local" only the JS/WASM build? Affects deployment on Vercel/serverless.
- Max docs per index — 14k rows is small; need confirmation for the 6-supplier aggregate (~100k+ rows).
- Real cost of `add_docs` for 14k rows and re-index on inventory updates.
- AgentPhone integration: is there a Moss plug-in, or do we wire through Pipecat/LiveKit underneath AgentPhone?
- Reranker model details — is it a cross-encoder pass or just hybrid scoring?
- Hackathon credit grant + sponsor Slack channel.

## Links

- https://www.moss.dev/
- https://docs.moss.dev/
- https://docs.moss.dev/llms.txt
- https://www.moss.dev/pricing
- https://www.ycombinator.com/companies/moss
- https://www.ycombinator.com/launches/Oiq-moss-real-time-semantic-search-for-conversational-ai
