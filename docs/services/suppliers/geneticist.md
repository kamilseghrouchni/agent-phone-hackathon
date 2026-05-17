# Geneticist Inc.

Biospecimen supplier. Glendale, California. BD contact on file: Veranika "Vera" Cache (Director of Operation).

## Web presence

- Canonical URL: https://geneticistusa.com/
- Status: active. HTTPS, no Cloudflare interstitial, no region block, no captcha on landing or contact pages.
- Platform: Squarespace (DOM uses `sqs-` class prefixes; rendered via Squarespace form blocks).
- Sitemap surfaces: `/`, `/who-we-are`, `/what-is-a-biorepository`, `/ethics`, `/tissue-microarrays`, `/frozen-tissue-samples`, `/ffpe-blocks`, `/blood-samples`, `/biofluid-samples`, `/frozen-cells`, `/sample-collection-formats`, `/cro-services`, `/custom-services`, `/ctm-logistics`, `/specimen-extraction-and-collection-process`, `/orderinquiries`, `/contact-us`, `/blog`, `/privacy`.
- Sister property: `referencemedicine.com` (newsletter form on Geneticist site posts there — same operator).

## Contact form

Two forms exist, both Squarespace-rendered (POST to Squarespace form-submission endpoint; no public action URL — JS-handled). Auth: none. Captcha: none observed.

`/orderinquiries` — primary quote/sample-request form:
- First Name (required, text)
- Last Name (required, text)
- Company (optional, text)
- Email Address (required, email)
- Phone (optional, tel)
- Requested Products and/or Services (required, textarea)
- Submit button label: "Submit Request"

`/contact-us` — generic contact:
- First Name (required), Last Name (required), Email (required), Subject (required), Message (required).

No file upload field on either form. No order-history / customer-portal login surface anywhere on the site.

## BD contact info

Veranika Cache is publicly visible:
- Footer LinkedIn icon links to Geneticist company page with anchor text "Veranika Cache" → https://www.linkedin.com/company/1226147
- `/contact-us` lists `Vera@geneticist.net` as a primary email alongside `info@geneticist.net`.
- Title "Director of Operation" not stated on the public site; sourced externally.

Generic channels:
- Email: info@geneticist.net (footer site-wide), Vera@geneticist.net (/contact-us only).
- Phone: (818) 662-6927.
- Fax: (818) 662-6967.
- Address: 520 West Colorado Street, Glendale, California, 91204, US.
- Social: Facebook (facebook.com/geneticistinc), Twitter (@Geneticist_inc — embedded feed on homepage).

## Catalog

- Format: descriptive HTML pages per category. No table, no Airtable, no Notion, no xlsx/pdf, no filter UI, no search beyond a generic site searchbox.
- Public: yes. Login: none.
- Per-category pages list tissue/condition coverage as bulleted prose, not as line-itemed SKU records.
- No item-level identifiers, no per-sample quantities, no per-sample pricing exposed.
- "Browse our Inventory" link on landing routes to `/tissue-microarrays` (a marketing page, not an inventory listing).

## Sample types and conditions

Six product pages mirror the supplier directory:
- TMAs (`/tissue-microarrays`)
- Frozen tissue (`/frozen-tissue-samples`) — 24+ organ systems including bladder, brain, breast, cervix, colorectal, head and neck, kidney, liver, lung, ovary, pancreas, prostate, skin, stomach, testis, thyroid, uterus, esophagus, adrenal gland, melanoma, soft tissue sarcoma, lymph nodes
- FFPE tissue (`/ffpe-blocks`)
- Blood (`/blood-samples`)
- Biofluids (`/biofluid-samples`) — CSF, urine, synovial, stool, ascites, sputum per supplier directory
- Frozen cells (`/frozen-cells`) — bone marrow, hematological
Disease coverage: oncology, dermatology, neurology, immunology, infectious diseases, autoimmune, metabolic.

## Red flags

- No filterable catalog. Every request is free-text into a single textarea — the agent cannot pre-validate availability before sending.
- Generator meta is hidden; Squarespace form endpoints are JS-handled, not a stable POST URL. Headless form-fill is feasible but brittle (CSS selectors, not field `name` attrs).
- No CRM/ticket portal. No quote ID returned to user. Reply path is email-only.
- Twitter feed embed on homepage; last public-blog post recency unconfirmed (content cadence may be stale, but contact channel is live).
- Sister-site newsletter form posts cross-domain to `referencemedicine.com`. Worth flagging that the operator runs multiple brands.

## What this means for our agent

- **Source agent:** cannot scrape an inventory. Treat Geneticist as a "describe-then-ask" supplier: send a structured request (tissue type, disease, format, n, pathology requirements) and rely on human reply. The site itself is not a knowledge source for SKU-level matching.
- **Correspond agent:** primary channel is email. Use `Vera@geneticist.net` for BD-level outreach (warm path), `info@geneticist.net` for generic. Phone (818) 662-6927 is a viable fallback. Expect an account manager reply within 24h (per /contact-us copy).
- **Fill agent:** the `/orderinquiries` form is the canonical web-submission surface. 6 fields, only 4 required. Build a Playwright filler keyed on textbox accessible-names ("First Name", "Last Name", "Email Address", "Requested Products and/or Services") since Squarespace omits stable `name` attributes. Submit button accessible-name: "Submit Request". No captcha observed — schedule a re-check before launch since Squarespace can enable hCaptcha per-site.
- **Converse agent:** phone is published and answered during business hours. Direct asset for "ask before submitting" flows.

## Screenshots

- /Users/kamilseghrouchni/Desktop/side-projects/crovi-amc-mvp/docs/services/suppliers/_screenshots/geneticist-form.png — full-page render of `/orderinquiries`.

## Links

- Home: https://geneticistusa.com/
- Quote form: https://geneticistusa.com/orderinquiries
- Contact: https://geneticistusa.com/contact-us
- Product pages: https://geneticistusa.com/tissue-microarrays, /frozen-tissue-samples, /ffpe-blocks, /blood-samples, /biofluid-samples, /frozen-cells
- LinkedIn (company): https://www.linkedin.com/company/1226147
- Twitter: https://twitter.com/Geneticist_inc
- Facebook: https://www.facebook.com/geneticistinc/
