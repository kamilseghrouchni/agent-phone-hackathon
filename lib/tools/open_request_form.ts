export type OpenRequestFormPrefill = {
  institute_ids?: string[];
  query_text?: string;
  specifics?: string;
  scope: "audit_deeper" | "source_wider";
};

export type OpenRequestFormResult = {
  prefill: OpenRequestFormPrefill;
  scope: "audit_deeper" | "source_wider";
};

export function openrequestform(prefill: OpenRequestFormPrefill): OpenRequestFormResult {
  return { prefill, scope: prefill.scope };
}
