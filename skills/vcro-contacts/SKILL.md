---
name: vcro-contacts
description: "Contact extraction for cohort access. Extracts PI names, institutions, portal URLs, IRB numbers, and data sharing statements from cohort sources. Use when the pipeline has identified top cohorts and needs to find who controls access."
---

# vcro-contacts

Find who to call for each cohort.

## Input

- `recommendation.json` from a run folder (top cohorts)
- PMC meta.json files (contain author lists, affiliations, emails)
- ClinicalTrials meta.json files (contain PI, facility, contact info)

## Workflow

### Step 1 — For each top cohort, find the source

Read the cohort's source type:
- If literature: go to `sources/pmc/{pmc_id}/meta.json`
- If clinicaltrials: go to `sources/clinicaltrials/{nct_id}/meta.json`

### Step 2 — Extract contact info

**From PMC meta.json:**
- `first_author` and `last_author` (usually the PI is last author)
- `authors` full list with affiliations if available
- `doi` for lookup
- Check `access_and_ownership.txt` for:
  - "data available upon request to..." or "contact [name] at [email]"
  - Portal URLs (e.g. "https://ida.loni.usc.edu", "https://www.ukbiobank.ac.uk")
  - DUA/MTA requirements mentioned
  - IRB protocol numbers (e.g. "HUM00028826")
  - Data sharing statements and their scope (academic only, qualified investigators, etc.)

**From ClinicalTrials meta.json:**
- `protocolSection.contactsLocationsModule.overallOfficials` → PI name + affiliation
- `protocolSection.contactsLocationsModule.centralContacts` → email + phone
- `protocolSection.contactsLocationsModule.locations` → facilities with contacts
- `protocolSection.ipdSharingStatementModule` → data sharing plan URL and description

**From trial_sites.json (if available):**
- Cross-reference the institution with trial site participation
- If the same hospital appears in 5+ trials for this indication,
  note that in the contact entry (signals active clinical program)

### Step 3 — Write contacts.json

For each cohort in the recommendation:

```json
{
  "cohort_id": "...",
  "cohort_name": "...",
  "contacts": [
    {
      "role": "PI" | "corresponding_author" | "data_manager" | "site_contact",
      "name": "Dr. X",
      "institution": "University of Y",
      "email": "x@y.edu" | null,
      "source": "meta.json" | "access_and_ownership.txt" | "clinicaltrials"
    }
  ],
  "access_route": "Contact last author" | "ClinicalTrials listed contact" | "Data sharing portal" | "Unknown",
  "portal_url": "https://ida.loni.usc.edu" | null,
  "irb_number": "HUM00028826" | null,
  "dua_required": true | false | null,
  "data_sharing_statement": "Anonymized data available upon request from qualified investigators" | null,
  "trial_participation": 5
}
```

### Step 4 — Flag gaps

If a top cohort has no extractable contact, flag it:
```json
{
  "cohort_id": "...",
  "contacts": [],
  "access_route": "Unknown. No contact found in available sources."
}
```

These get surfaced in the recommendation as "contact information unavailable."

## Rules

- Extract only from stored metadata and section files. Do NOT web scrape
  for emails unless explicitly approved.
- Do not fabricate contact info. If it is not in the source, say so.
- Prefer last/corresponding author for literature cohorts.
- Prefer overallOfficials for ClinicalTrials cohorts.

## Model allocation

Haiku. This is structured extraction from metadata, not synthesis.
