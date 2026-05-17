# vCRO MVP — Conversational Biobank Discovery


## Run it

```bash
# 1. set your API key
cp .env.example .env.local
# put your ANTHROPIC_API_KEY in .env.local

# 2. install
npm install

# 3. data prep (one-time)
npm run data:prep

# 4. dev
npm run dev
# open http://localhost:3000
```

## Architecture (one line each)

- `data/specimens.db` — 486,754 specimens, 161,374 donors, 18 institutes (gitignored, copied from AminoChain dump)
- `data/enriched/` — `orgs.json`, `publications.json`, `synonyms.json`, `curated_queries.json`, `views.db` (FTS5 + longitudinal materialized view)
- `app/api/agent/route.ts` — `streamText` with 4 tools, Sonnet 4.6, prompt caching
- `lib/filters.ts` — delta merge + synonym resolution + signature hashing
- `lib/tools/*` — server-side tool implementations (deterministic; LLM only calls them)
- `components/Canvas/Canvas.tsx` — slot registry + insert/replace/dim mutation engine
- `components/ChatRail/ChatRail.tsx` — streaming chat with tool-call cards
- `components/primitives/*` — `InstituteList`, `PublicationPanel`, `GapCard`, `RequestForm`

## What the LLM does

1. Extracts filters from natural language into tool args (no separate parse step)
2. Picks the right tool: `query_specimens` / `find_publications` / `compare_institutes` / `open_request_form`
3. Narrates briefly

Everything else (SQL, grouping, gap detection, ranking, fuzzy match, layout) is deterministic on the server.

## Try

Curated chips on the landing page cover six demo roles: happy-path, rich-publications, thin-result → source_wider, multi-gap, longitudinal, follow-up-to-compare. Then talk back to the agent:

- "drop ones without contact emails"
- "group by country"
- "only longitudinal donors"
- "compare Mayo SPORE vs ProteoGenex"
