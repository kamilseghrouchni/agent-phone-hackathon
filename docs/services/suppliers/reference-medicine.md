# Reference Medicine

US-based oncology biospecimen vendor. Phoenix, AZ. CLIA-certified lab (CLIA ID 03D2269440). Built on Webflow; uses Airtable for inventory and Jotform for quote intake.

## Web presence

- Canonical: `https://www.referencemedicine.com/` (active, 200 OK, Webflow CDN)
- Status: Active, content dated 15-MAY-2026 (current). Last published timestamp on every page.
- Sitemap (linked from nav): `/process`, `/products`, `/pricing`, `/inventory`, `/about`, `/contact-us`, `/request-quote`, `/try-a-block`, `/blog`, `/case-studies`, `/news`, `/research`, `/laboratory-accreditation`
- Sub-pages for biospecimen categories: `/biospecimens/ffpe`, `/biospecimens/ngs`, `/biospecimens/matched-sets`, `/biospecimens/blood-products`

## Public contact channels

- Generic email: `hello@referencemedicine.com` (mailto link, only published address; no `sales@`, `info@`, `orders@`)
- Phone: none published on contact page
- Office address: `4050 E Cotton Center Blvd, Building 3, Suite 38, Phoenix, AZ 85040`
- Booking links on `/` homepage (publicly listed staff with role + Calendly):
  - Inga Rose, CEO — `calendly.com/inga-rose/30min`
  - Gray Dragin, Director of Client Relations — `calendly.com/gray-referencemedicine/30min`
  - Mario Melendez, Head of Customer Experience — `calendly.com/mario-referencemedicine/30min`
  - Aaron Schlum, Head of Development & QA — `calendly.com/aaron-referencemedicine/30min`
- Socials: LinkedIn `company/reference-medicine`, Facebook, X (`@ReferenceMed`)

## Quote / order form

- URL: `https://www.referencemedicine.com/request-quote`
- Implementation: Jotform iframe embed, `https://form.jotform.com/252728761356061`
- Submission: POST to Jotform endpoint (not mailto). No login required. No reCAPTCHA observed.
- Multi-step form, sections + fields:
  - General Information: First name, Last name, Job title, Company/Institution name, Email, Phone (Area code, Number)
  - Shipping Information: Ship-to country, Street Address, Street Address Line 2, City, State, Zip Code (block repeats — likely billing vs shipping)
  - Specimen Details: "Which of these best applies to this request?" (radio), Specimen list upload (file), Diagnosis types (Cancer / Healthy / Other), Area of cancer study (multi-select), Specimen types (multi-select), Biomarkers of interest, Specimen requirements, Additional documents (file, optional)
  - Hidden honeypot field present.
- Secondary contact form (on `/contact-us`): Webflow `wf-form-Contact`, fields: `contact-first-name`, `contact-last-name`, `contact-email`, `contact-company`, `contact-title`, `contact-message`, plus honeypot + Cloudflare Turnstile (`cf-turnstile-response`, sitekey `0x4AAAAAAAQTptj2So4dx43e`). Method attr `get` but Webflow forms POST via JS to Webflow backend.
- Try-a-block CTA (`/try-a-block`) uses a separate Jotform: `jotform.com/jsform/221606002893046`.

## Public catalog (Airtable, fully public)

- Format: Airtable embedded iframes, one shared base `appnLnj6SNHLCoMJs` with 6 view share IDs across 6 pages.
- No login required. No captcha. Fully public, indexable.
- Filter controls: Airtable native (search, column filters, view switcher because `viewControls=on`). Filter-as-URL-parameter: Airtable share embed URLs do NOT support `?filterByFormula=` or `?prefill_FIELD=` (that's the Airtable Forms-only feature). Programmatic filtering of these shares is not possible via URL — they're view-bound shares; the embedded UI's own search box is the only public filter surface.
- Inventory download: `https://cdn.prod.website-files.com/616752befb7ff04714325b37/6a075f986ff43c65f9ef6b7b_15-MAY-2026%20Reference%20Medicine%20inventory%20%26%20order%20form.xlsx` (.xlsx, public, weekly-dated filename suggests weekly refresh).
- Columns referenced on the page: case ID, genomic alteration(s) detected, methodology, IHC/ISH results.

Airtable view share URLs:

| Sub-page | Share URL |
|---|---|
| `/inventory` (Cases) | `https://airtable.com/embed/appnLnj6SNHLCoMJs/shrO3brRgsnGK0bey?backgroundColor=blue&viewControls=on` |
| `/inventory-all-specimens` | `…/shrHhk3ZKPcS0dvXH` |
| `/inventory-oncology-fluids` | `…/shrVrcypVV7WwICQe` |
| `/inventory-benign-tumor-fluids` | `…/shrscv2twUYgWepYk` |
| `/inventory-healthy-fluids` | `…/shrR3966TdxC9wFYb` |
| `/inventory-tissue-blocks` | `…/shrPsWFRKknYfJkcE` |

## Sample types & conditions

- FFPE tissue blocks (tumor + normal). QC spec: 5 mm² tumor area, ≥20% tumor, ≤50% necrosis, ≥1 mm thickness.
- NGS-screened FFPE blocks (biomarker-characterised). XLSX delivered; PDF genomic reports on request. Variants, fusions, MSI-high, TMB-high.
- Matched sets: FFPE tumor + double-spun Streck/EDTA plasma + buffy coat. Frozen bone marrow for heme malignancies. Tumor+normal tissue add-on.
- Blood products: plasma + buffy coat aliquots, EDTA or Streck, double-spun, hemolysis score < 2.
- Add-on services: microtomy, whole-slide imaging, nucleic-acid extraction (DNA / RNA / cfDNA).
- Pipeline (not yet in catalog): matched frozen tissue (-80°C), longitudinal (2–4 timepoints), matched stool + urine.
- Monthly case volume by indication published on homepage (Colorectal 75–100/mo top; Bladder, Breast, Lung 10–20; Brain, Liver, Cervix 0–5).
- Pricing published: FFPE block from $250; oncology plasma from $150/mL; healthy plasma $100/mL.

## Red flags

- Cloudflare Turnstile on Webflow contact + newsletter forms (not on Jotform quote form). Agent submissions must solve Turnstile or hit Jotform only.
- Webflow forms set `method="get"` but actually POST via JS — naive scrapers will mis-handle.
- No published `sales@` / `orders@` alias. All routing goes through `hello@` or named Calendly bookings.
- No phone listed publicly.
- Browser tab hijack observed during research (unrelated automation pulled the live page mid-session to Audubon/Geneticist/Biomedica/Ukraine-Biobank). Affected one Playwright session only; HTTP fetches were clean.

## What this means for our agent

- **Source agent**: Fetch the 6 Airtable share embeds → scrape rendered table via headless browser (no API). Or download the weekly `.xlsx` (single URL, parseable, includes order form). XLSX is the cheaper path and the recommended "fresh-inventory" snapshot. Re-fetch weekly using the dated filename pattern.
- **Correspond agent**: Single inbox `hello@referencemedicine.com` plus 4 named Calendly links. No `sales@` to scrape. For a research-direction inquiry, route to Gray (client relations); for ordering, route to Mario; for technical/QC, route to Aaron.
- **Fill agent**: Jotform quote (`/request-quote`) is the canonical structured intake. 17+ fields, multi-step, file upload, no captcha — automatable. Webflow contact form is unstructured (one message textarea) and Turnstile-gated — avoid for structured handoff. Pre-fill candidates (from our request schema): diagnosis type, area of cancer study, specimen types, biomarkers of interest, specimen requirements.
- **Converse agent**: 4 named-staff Calendly links exposed publicly — agent can present a "book a call" option when the human conversation needs to escalate. Treat the Calendly URLs as the supplier's preferred handoff surface.

## Screenshots

- `_screenshots/reference-medicine-home.png`
- `_screenshots/reference-medicine-inventory.png`
- `_screenshots/reference-medicine-request-quote.png`
- `_screenshots/reference-medicine-contact.png`

## Links

- Home: https://www.referencemedicine.com/
- Inventory: https://www.referencemedicine.com/inventory
- Inventory download (xlsx): https://cdn.prod.website-files.com/616752befb7ff04714325b37/6a075f986ff43c65f9ef6b7b_15-MAY-2026%20Reference%20Medicine%20inventory%20%26%20order%20form.xlsx
- Request quote: https://www.referencemedicine.com/request-quote
- Jotform quote: https://form.jotform.com/252728761356061
- Contact: https://www.referencemedicine.com/contact-us
- Pricing: https://www.referencemedicine.com/pricing
- Try-a-block: https://www.referencemedicine.com/try-a-block
- Accreditation: https://www.referencemedicine.com/laboratory-accreditation
