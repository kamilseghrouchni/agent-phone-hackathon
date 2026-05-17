# Ukraine Association of Biobank (UAB)

BD contact on file: Dr. Svetlana (Svitlana) Gramatiuk — President.

## Web presence
- Canonical: https://ukrainebiobank.com/ (WordPress, nginx, HTTP/2 200).
- Brand registered in Austria as "Ukrainian Association of Biobank Austria – Verein zur Vernetzung der ukrainischen Biobanken mit der europäischen Forschergemeinschaft" (ZVR-Zahl 1062912887). Footer copyright 2026.
- Status: active but stale. Latest blog post is stale; no recent content.
- Headless behavior: page sometimes JS-redirects to https://geneticistusa.com/contact-us (Geneticist Inc, US biorepository) after DOMContentLoaded in some sessions. Server HTML and direct curl always return the real site. Likely a third-party affiliate/partner script. Treat as a rendering risk for agents.
- Public socials: LinkedIn (company/ukraine-association-of-biobank), Facebook (UkraineBiobank), Instagram (@biobank.ukr.eu), X (@UkraineBiobank).
- Sister org found: https://uarb.org/en/ ("Ukrainian Association of Research Biobanks"). Separate entity. Not investigated further.

## Contact form
- URL: https://ukrainebiobank.com/contact-us/ (also embedded on /products/, /services/, /about-us/).
- Engine: Contact Form 7 (`wpcf7`). Submission type: POST to `/contact-us/#wpcf7-f135-o1` (AJAX endpoint `wp-json/contact-form-7/v1/...`). No mailto. No auth, no captcha visible in DOM.
- Form A (general contact) — 6 visible fields: `name-me` (required), `surname`, `email` (required), `tel`, `text` (company name), `textarea` (message, required). Plus 6 hidden wpcf7 nonce/hash fields.
- Form B (careers / "Become team member") — same fields plus `file` upload (`.jpg,.png,.pdf`), `enctype=multipart/form-data`.
- No dedicated "Request a quote" / "Sample request" form. The general contact form is the only intake surface.

## BD contact info
Public team page lists 12+ named staff with direct emails:
- **Dr. Svetlana Gramatiuk — President UAB Austria** — `gramatyuk@ukrainebiobank.com` (note spelling `gramatyuk`, not `gramatiuk`).
- Nikola Alyeksyeyenko — Director UAB Austria / Finance — `finance@ukrainebiobank.com`.
- Dr. Anna Kurbatova — European Operations Director & Clinical Trial — `kurbatova@ukrainebiobank.com`.
- Armin Nöbauer — Project Manager — `a.nobauer@ukrainebiobank.com`.
- MCs Olena Renner — Head Law & Ethics — `o.renner@ukrainebiobank.com`.
- Prof. Yulia Ivanova — PI oncology / Head of Project Description — `ivanova@ukrainebiobank.com`.
- Generic alias: `info@ukrainebiobank.com`.
- Phones: +43 676 4124733 (Austria), +38 099 1549144 (Ukraine).

## Catalog
- None. No Airtable, no Notion, no table, no xlsx, no PDF inventory. `/products/` and `/services/` are marketing landing pages with text only; the "Categories: 6/8" UI is empty taxonomy.
- WP REST API (`/wp-json/wp/v2/types`) exposes no `product` or `inventory` custom post type. Only generic pages, posts, person, projects, news, stem-cell-clinic, liver-disease.
- Filterable: no. Item count: 0 listed.
- Public-or-login: n/a (no catalog).

## Sample types & conditions
On-file types are NOT confirmed by the site. Site (`/products/`) states only generic offer:
- "broad range of biofluids from both healthy patients and those with medical conditions"
- "clinical remnants" and "banked and prospectively collected biofluids"
- "diverse, global network of providers"

Third-party listing (biobanking.com profile of UAB) describes: FFPE and fresh-frozen tissues, tissue microarrays, blood derivatives (serum, buffy coat), bodily fluids (urine, saliva, sputum, synovial fluid, ascites), stem cell varieties, 3D cultures. This overlaps with our on-file list (serum/plasma, buffy/PBMC, swab, urine, stool, matched FFPE/frozen/fresh tumor) but is unverified on UAB's own site.

UAB is described elsewhere as the only Ukrainian biobank with ISO 20387 certification; its President co-founded UAB in 2017 and runs the Institute of Cellular Biorehabilitation (Kharkiv).

## Red flags
- Stale: recent news cadence is slow.
- Rogue JS redirect to geneticistusa.com observed in headless Chromium — agents may land on the wrong site.
- No actual catalog or sample-request form; everything funnels to one Contact Form 7 or email.
- Austria-based legal entity (ZVR-Zahl); Ukraine ops in active war zone — fulfilment risk for fresh-tissue and cold-chain shipments.
- All site copy in English (no Ukrainian-only barrier). No login wall, no captcha, no Cloudflare interstitial. No region lock observed from US IP.
- Email domain mismatch: President's address is `gramatyuk@` (Ukrainian transliteration); name written as both "Gramatiuk" and "Gramatyuk" across pages. Agents must use the `gramatyuk` spelling for email.

## What this means for our agent
- **Source agent** — Cannot scrape a catalog. Treat UAB as a "no-list, ask-by-RFQ" supplier. Seed prompts must include the explicit sample manifest (n, fluid, tissue, condition, longitudinal y/n) because the supplier cannot be filtered upstream.
- **Correspond agent** — Email is the canonical channel. Send to `gramatyuk@ukrainebiobank.com` (primary BD) with `kurbatova@ukrainebiobank.com` (ops) on cc and `info@ukrainebiobank.com` on cc as fallback. Subject line should name a project; the org's vocabulary leans "clinical research" not "biospecimen procurement". Phones available if escalation needed (+43, +38).
- **Fill agent** — One form, Contact Form 7, POST submission. Field map: `name-me`, `surname`, `email`, `tel`, `text` (company), `textarea` (request body). No `subject` field; encode subject in the textarea. Honor wpcf7 nonce by re-fetching `/contact-us/` first. Mitigate the rogue JS redirect by disabling third-party scripts or by skipping browser render and posting directly to the wpcf7 AJAX endpoint.
- **Converse agent** — No live chat, no scheduling widget. Agent should propose Zoom/Teams times by email; UAB team is on European hours (Austria GMT+1/+2). Expect English fluency from President and Ops Director.

## Screenshots
- `_screenshots/ukraine-biobank-association-form.png` — full-page render of `/contact-us/` showing both Contact Form 7 instances (general and careers/file-upload).

## Links
- Site: https://ukrainebiobank.com/
- About / team: https://ukrainebiobank.com/about-us/
- Contact: https://ukrainebiobank.com/contact-us/
- Products (placeholder): https://ukrainebiobank.com/products/
- Services (placeholder): https://ukrainebiobank.com/services/
- WP REST root: https://ukrainebiobank.com/wp-json/
- Third-party profile: https://www.biobanking.com/ukraine-association-of-biobank/
- President bio (Science At Risk): https://scienceatrisk.org/story/bank-of-the-human-body-and-inhuman-war
- LinkedIn: https://www.linkedin.com/company/ukraine-association-of-biobank
- Sister org (separate): https://uarb.org/en/
