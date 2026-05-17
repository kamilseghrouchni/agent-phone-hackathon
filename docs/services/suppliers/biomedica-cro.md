# Biomedica CRO

Investigated via Playwright (read-only, no submissions).

## Web presence
- Canonical: https://biomedica-cro.com/
- Status: active. Recent blog post: "From Inventory to Insight... 32,000+ Samples Available". Site is in English with UA mirror at /uk/.
- Hosting/CDN: WordPress install with Squarespace/Webflow template residue (orphan `<form action="https://geneticistusa.com/contact-us">` from a template scrape). Phone +38 (068) 150 70 04, Kyiv office. Despite war banner, runs as usual.
- Site search: none. Navigation: Biospecimens, Disease Areas, Ethics, Blog, About us, Contacts.

## Contact form
- URLs: https://biomedica-cro.com/contacts/ (general) and home page (also has the same form). "SEND REQUEST" button in header is href="#" — opens nothing, no modal.
- Submission type: Squarespace-style React form (`form.react-form-contents`) submitted via JS to a backend endpoint. No visible `action` attribute on the real visible form — handler is async. Not a `mailto:`. Submit button stays `disabled` until reCAPTCHA passes.
- Field count: 4 inputs + 1 checkbox + reCAPTCHA. Fields: Name (text), Company name (text), E-mail (text), Your message (textarea), Privacy-policy checkbox (required), Google reCAPTCHA v2 "I'm not a robot".
- Inventory unlock form (separate, at /human-biospecimens-procurement/inventory/): Name + Company name + E-mail + privacy checkbox + reCAPTCHA. Submits to gain access to "newest Inventory" file. No login created.
- Auth required: none. reCAPTCHA only.

## BD contact info
- Public on site (about-us): Ostap Kupnovitsky (Chairman), Anton Zubov (Board Member), Serhii Samsoniuk (CEO), Iryna Iurkova (Business Development Director). No photos, no direct emails.
- Daria Tomilina: NOT listed on biomedica-cro.com. Surfaces on ZoomInfo as "Business Development Manager / Chief Revenue Officer at Biomedica Cro" (email masked as d***@biomedica-cro.com). Treat as off-site intel, not a web-visible handle.
- Generic alias: office@biomedica-cro.com (shown in header, footer, contacts page, inventory page). Phone tel:+380681507004. LinkedIn: linkedin.com/company/biomedica-cro.
- No sales@, no inquiries@, no per-person emails published.

## Catalog
- Format: gated PDF / Excel. The "Inventory" page is a marketing wrapper around a request-form. No public Airtable, Notion, table, or filterable UI.
- URL: https://biomedica-cro.com/human-biospecimens-procurement/inventory/
- Public-or-login: form-gated. Submit Name/Company/Email + reCAPTCHA, then they email a file (presumed; not verified — we did not submit).
- Filterable: no (file is delivered post-submit, content unknown).
- Approx item count: "32,000+ Samples Available" per recent blog post.

## Sample types & conditions
Confirmed against site copy (home page + inventory page):
- Tissue: fresh, fresh frozen, FFPE blocks, histological slides; diseased and normal-adjacent.
- Blood: whole blood, plasma, double-spun plasma, serum, red cells, buffy coat, PBMCs.
- Other biofluids: sputum, saliva, aspirate, swabs, urine, stool, synovial fluid (SF), cerebrospinal fluid (CSF). Home page also mentions nails.
- Disease areas (17): oncology, allergology, autoimmune, cardiology, dermatology, endocrinology, gastroenterology, gynecology and urology, hematology, infections (incl. COVID-19), ICU, neurology, ophthalmology, pulmonology, reproductology, rheumatic disorders, traumatology.
- Collection model: prospective (1–2 weeks to launch post-PO) and retrospective. They explicitly state "we do not resell" — own collection only.
- Geo source: Ukraine hospitals (50+ partnered sites). Worldwide shipping.
- Listed marketplaces: iSpecimen (Gold), Science Exchange, ISBER. Reachable through those channels too.

## Red flags
- No filterable catalog. Inventory is a gated file, not a UI. Cannot price or filter without submitting the form.
- Form is reCAPTCHA-gated. Submit button is `disabled` until human passes. Blocks naive scripted submission.
- Orphan `<form action="https://geneticistusa.com/contact-us">` and "Subscribe to Reference Medicine newsletter" widgets injected into the DOM from template scraping. One tab auto-redirected to referencemedicine.com during JS load. The visible form is React-rendered; the scrape-residue forms are non-functional.
- Daria Tomilina (the BD on file) is not surfaced on the public site. Her email pattern (d.tomilina@ / daria@) is unverified; ZoomInfo masks it.
- Footer copyright 2021 (cosmetic, content is fresh).
- Region: Ukraine-based. Active war context disclosed on site, declared "work as usual". No region lock observed; site loads from US IP.
- No Cloudflare challenge, no login wall, no captcha on read pages.

## What this means for our agent

### Source agent
Site does not expose a public, filterable catalog. Inventory cardinality (32,000+) is known from the blog only. Source agent cannot derive cohort fit from biomedica-cro.com alone — it must either (a) call the inventory unlock form to receive the file, or (b) treat Biomedica as "request-only" and let Correspond reach them. Disease-area and sample-type taxonomy is extractable from the public site as fixed strings.

### Correspond agent
One generic email: office@biomedica-cro.com. No per-person addresses on site. To reach Daria Tomilina specifically, agent needs an out-of-band email pattern (likely d.tomilina@biomedica-cro.com — unverified) or must address via office@ and request her by name. LinkedIn (company page) is the only other public channel. No phone IVR — single Ukrainian mobile.

### Fill agent
Two forms in scope: contacts form (4 text fields + privacy checkbox + reCAPTCHA) and inventory unlock form (3 text fields + privacy checkbox + reCAPTCHA). Both block on Google reCAPTCHA v2. Submit button is `disabled` until the captcha token is set. Fill agent needs a captcha-solving step (2captcha/CapMonster) or human-in-the-loop for the final click. No login, no multi-step, no file upload. Field labels are stable English strings.

### Converse agent
Public phone is +380681507004 (Ukrainian mobile). Ukraine timezone EET (UTC+2/+3). No published voicemail, IVR, or call-back form. Voice agent is plausible but call quality across UA telephony with war-time disruption is unmodeled.

## Screenshots
- /Users/kamilseghrouchni/Desktop/side-projects/crovi-amc-mvp/docs/services/suppliers/_screenshots/biomedica-cro-form.png — full-page screenshot of the contacts page including the visible contact form.

## Links
- Home: https://biomedica-cro.com/
- Contacts: https://biomedica-cro.com/contacts/
- About us: https://biomedica-cro.com/about-us/
- Inventory request: https://biomedica-cro.com/human-biospecimens-procurement/inventory/
- Biospecimens overview: https://biomedica-cro.com/human-biospecimens-procurement/
- Blog post citing 32,000+ inventory: https://biomedica-cro.com/buy-biospecimens-buy-biospecimen-research/
- LinkedIn: https://www.linkedin.com/company/biomedica-cro
- ZoomInfo (Daria Tomilina, off-site): https://www.zoominfo.com/p/Daria-Tomilina/8614681631
