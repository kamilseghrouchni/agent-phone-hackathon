# Demo — institution detail pages

Three institution profiles, all built from the cohort-probe data in
`data/cohort-probes/`. Each one answers the same question shape from a
different angle:

> *A buyer searches for biospecimens. We surface a prospective capability
> they didn't know existed.*

## The three cases

| File | Hospital | Pattern |
|---|---|---|
| `card-louisville.md` | University of Louisville Hospital | AMC with own steward + reusable biorepository |
| `card-umc-nola.md` | UMC New Orleans | Clinical host for a partner-stewarded prospective cohort |
| `card-evergreen.md` | EvergreenHealth Kirkland | Community hospital — no published cohort, but live trial-site portfolio |

## The standardized schema

Every card has two layers.

### Layer 1 — Summary card (8 slots)

What a buyer sees first. Fits on one screen.

| Slot | What it proves |
|---|---|
| Program name | A specific thing exists, not a vibe |
| Steward (named PI + institution) | A human you can actually email |
| Pool size signal | Patients exist in the volume needed |
| Activity proof | It's running *now* |
| Reuse / external-access proof | Outsiders have gotten in before |
| Specimen + data depth | Matches the buyer's actual ask |
| Access path | The right door (often not the queried hospital) |
| Sources | PMID / PMC / NCT links backing every claim |

Empty slots stay visible — that's a signal too.

### Layer 2 — Deep dive (10 sections)

What a buyer sees when they click in. Same sections every site:

1. Header (institution + role tag + last verified)
2. Program inventory
3. Quantified evidence (numbers grid, every cell linked to source)
4. Variables captured per patient
5. People (named PIs with affiliations)
6. Reuse / external-access track record
7. Access path (operational map)
8. Source ledger (every PMC / NCT / URL we touched)
9. What we don't know (honest gaps)
10. How we found this (methodology footer)

## The single rule

No number, no name, no claim appears without a source link next to it.
If we can't source it, we don't show it. If a slot is empty, we show
that it's empty.

## Source URL conventions

- **PMC IDs** → `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC<N>/`
- **NCT IDs** → `https://clinicaltrials.gov/study/NCT<N>`
- **BioProject** → `https://www.ncbi.nlm.nih.gov/bioproject/<ID>`
- **GISAID** → `https://www.gisaid.org/`
- **Probe files** → `data/cohort-probes/<hospital>.md`
