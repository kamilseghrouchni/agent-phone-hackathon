import type { InstituteEntry, SpecimenRow } from "@/lib/tools/query_specimens";

export type ProviderType =
  | "ip_platform"        // owns assay IP, runs only their assay (Olink, NanoString)
  | "service_cro"        // multi-assay clinical CRO (Q², Labcorp, ICON)
  | "specialty_cro"      // assay-specialized CRO (GENEWIZ, Diagenode, Metabolon)
  | "vendor";            // hardware/kit vendor (Illumina, 10x, Bruker)

export type EnrichedSampleType = {
  type: string;
  n_papers: number;
  evidence_pmids: string[];
};

export type EnrichedIndication = { area: string; n_papers: number };
export type EnrichedPartner = { name: string; co_pubs: number };
export type EnrichedPublication = {
  pmid: string;
  doi?: string | null;
  pmc?: string | null;
  year: number | null;
  journal: string;
  title: string;
};

export type ProviderEnrichment = {
  publication_total: number;
  publications_indexed: number;
  address_hint?: string | null;        // single best HQ string
  contact_emails: string[];
  sample_types: EnrichedSampleType[];
  indication_areas: EnrichedIndication[];
  academic_partners: EnrichedPartner[];
  top_publications: EnrichedPublication[];
};

export type Provider = {
  id: string;            // slug
  name: string;
  parent?: string | null;
  type: ProviderType;
  country: string;
  assay_families: string[];
  specific_assays: string[];
  sample_types: string[];
  accreditation: string;
  url?: string;
  services_url?: string;
  evidence?: string;     // NCT IDs, PMC IDs, or web URL
  // ranking signals
  n_trials?: number;
  total_enrollment?: number;
  // PubMed-derived enrichment (optional; present if data/providers_enriched/{slug}.json exists)
  enrichment?: ProviderEnrichment;
};

export type AssayChoice = {
  assay: string;                   // specific_assay name
  family: string;                  // assay_family
  candidates: Provider[];          // ranked
  selected?: Provider[];           // 0..N picks per assay (no provider is allowed)
};

export type Bundle = {
  query: string;                   // raw query text
  samples: {
    institute_ids: string[];
    specimen_ids: string[];
    totals: { specimens: number; donors: number; institutes: number };
  };
  assays: AssayChoice[];
  selected_provider_ids: Record<string, string[]>;  // assay -> provider.ids (0..N)
};

export type BundleStep = "samples" | "providers" | "summary";

export type ProvidersApiResponse = {
  assays: AssayChoice[];
};
