# Audubon Bioscience

Method: Playwright DOM + WebFetch (read-only).

## Web presence

- Canonical: https://audubonbio.com/ — active, HTTP 200, no Cloudflare challenge, no login wall
- Stack: WordPress + Gravity Forms; detailed-request form is an embedded ClickUp iframe
- CookieHub consent dialog on first load (non-blocking)
- Related: biomedica-cro.com (CRO-services arm, separate site, reCAPTCHA v2 there)
- LinkedIn: https://www.linkedin.com/company/audubonbioscience/

## Public contact channels

- Aliases: info@audubonbio.com (general/quotes), careers@audubonbio.com (CV only). No sales@/orders@/procurement@.
- Phone: +1 (713) 724-0338 (Mon–Fri 8am–5pm CT)
- Contact: https://audubonbio.com/contact-us/ · Team: https://audubonbio.com/team/
- Offices published on contact page:
  - Houston HQ: TMC Innovation, 2450 Holcombe Blvd, Suite X, Houston TX 77021
  - New Orleans: BioInnovation Center, 1441 Canal St., Ste. 324, New Orleans LA 70112
  - Eurasia HQ: Danyla Shcherbakivskoho st. 4-A, Kyiv 03190, Ukraine
  - Ukraine Country: Kazimira Malevicha st. 86E, off. 4, Kyiv 03150
  - Turkey: Kaptan Paşa Mah. Piyalepaşa Bulvarı Famas Plaza A75 D8-9, Şişli, Istanbul

## Quote/order form

Two public forms. Both POST, no login, no captcha on audubonbio.com.

### Form A — short contact (`/contact-us/`)

- Action: `https://audubonbio.com/contact-us/#gf_2` (Gravity Forms, AJAX)
- Captcha: none. Honeypot: `ak_hp_textarea` (Akismet). Login: no.
- 9 visible fields: First Name*, Last Name*, Company Name*, Job Title, Email*, Phone, Additional Details (textarea), How did you first hear about us? (textarea), Consent*

### Form B — detailed biospecimen request (`/detailed-biospecimen-request/`)

- Embedded ClickUp iframe (Report Abuse → help.clickup.com); POST target is ClickUp, cross-origin
- Captcha: none. Login: no.
- ~27 visible fields: How did you hear about us?, Reference number, Company name*, Contact name*, Contact email*, Select project manager* (dropdown), Disease/Indications or "Healthy"*, Specimen formats* (donor-matched flag), Inclusion criteria, Exclusion criteria, Treatment conditions (dropdown), Number of cases — Breakdown*, Number of cases — Total*, Collection method (dropdown), Consumables provided? (dropdown), Sample volume & aliquots, Blood must be collected (dropdown), Collection & processing requirements, Testing requirements (IHC/PCR/rapid), Clinical data needed, Sample rejection requirements, Shipping conditions, Storage conditions, Shipping frequency, Shipment destination, Desired timeframe, Project Deadline, Description of research, Additional comments, Attachments (file upload), Privacy consent*

### Form C — newsletter (footer): Email*, Consent*. Not B2B.

## Public catalog

- Format: none. No browseable inventory, no Airtable/Notion/XLSX/PDF. Items visible: 0.
- Network claims only: 120+ clinical sites, 10 countries, 4 continents (US, Georgia, Ukraine, India, Ecuador, Romania, Moldova, Turkey, Bulgaria, Armenia).
- Ordering model: quote-based; no customer portal. FAQ: "request a quote ... A member of our team will reach out to you within 24 hours."

## Sample types & services

Directory hypotheses, all confirmed:

- H&E staining — `/tissues/` ("Histological (H&E) staining")
- Matched tissue sets — `/tissues/` (custom donor-matched tissue ↔ blood/biofluid)
- Matched biofluids sets — `/biofluids/` (multi-biofluid same donor, or +tissue/blood)
- Cell products matched sets — `/cell-products/` (PBMC + FFPE tissue, etc.)
- Gradient centrifugation / plasma / PBMC isolation — `/peripheral-blood/`
- Custom cell isolation — `/cell-products/`. Serum isolation — `/peripheral-blood/`

Also published: tissue sectioning/scrolls, extended pathologic review, IHC, molecular genetic analysis, TissueBridge FFPE Metabolomics, cell culture, cryopreservation, leukopaks (standard/mobilized/cryopreserved), BMMC, DTC.

Sample types: fresh/FFPE/fresh-frozen tissue; whole blood, serum, plasma; PBMC, BMMC, DTC; urine, CSF, synovial fluid, BAL, saliva/sputum, bone marrow aspirate, ocular fluids.

Disease areas: Oncology, COVID-19, Benign Tumors, Hematology, Dermatology, Rheumatology.

## Red flags

- No public catalog/SKU list — every inquiry gated through Form A or B; agent cannot pre-validate availability.
- Form B is a ClickUp iframe — POST target is not audubonbio.com; programmatic submit hits ClickUp.
- Ukraine/Eurasia operational footprint — supply-continuity risk (own 2024 news post on Ukrainian biobanking law).
- Cookie banner fires on first visit (auto-accept needed for headless).
- Cloudflare cookie present (`__cf`) — not blocking; aggressive scraping may trigger challenges.
- Sister-domain biomedica-cro.com uses reCAPTCHA v2 — captcha wall if agent routes there.

## What this means for our agent

- **Source**: `/tissues/`, `/peripheral-blood/`, `/cell-products/`, `/biofluids/`, `/disease-areas/`, `/geographical-locations/` are server-rendered and parseable. No inventory feed — treat Audubon as custom-collection, not catalog. Cannot ground "they have N of X" claims.
- **Correspond**: canonical alias is `info@audubonbio.com` (no sales/orders alias). For project-specific intent, route user to Form B; it captures more structured data than free-text email.
- **Fill — Form A**: 9 fields, no captcha, no login. Gravity Forms names: `input_1.3` first, `input_1.6` last, `input_2` company, `input_3` job title, `input_4` email, `input_5` phone, `input_6` details, `input_9` referrer, `input_7.1` consent. Honeypot `ak_hp_textarea` must stay blank.
- **Fill — Form B**: ClickUp cross-origin iframe; needs Playwright `frame.evaluate` or postMessage, not a plain fetch. Field labels are stable; input names are not.
- **Converse**: 24h SLA self-published. Reply will come from a "procurement specialist" (their term) via info@audubonbio.com. No public pricing — no rate card to assume.

## Screenshots

- `/Users/kamilseghrouchni/Desktop/side-projects/crovi-amc-mvp/docs/services/suppliers/_screenshots/audubon-bioscience-form.png` — full-page capture of `audubonbio.com/contact-us/` (Form A + office list)

## Links

- Home: https://audubonbio.com/
- Short contact form: https://audubonbio.com/contact-us/
- Detailed biospecimen request form: https://audubonbio.com/detailed-biospecimen-request/
- Tissues: https://audubonbio.com/tissues/
- Peripheral blood: https://audubonbio.com/peripheral-blood/
- Cell products: https://audubonbio.com/cell-products/
- Biofluids: https://audubonbio.com/biofluids/
- Disease areas: https://audubonbio.com/disease-areas/
- Geographical locations: https://audubonbio.com/geographical-locations/
- Team: https://audubonbio.com/team/
- FAQ: https://audubonbio.com/faqs/
- Privacy policy: https://audubonbio.com/privacy-policy/
- LinkedIn: https://www.linkedin.com/company/audubonbioscience/
