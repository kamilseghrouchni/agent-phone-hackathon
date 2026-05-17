// Slot value formatters — referenced by name from YAML `format:` keys.
// Pure functions, no LLM. Registry shape so unknown formats fail loudly
// at Builder time rather than producing garbage at the wire.

import type { SpecimenRequest } from "@/types/parsed-query";

export type Formatter = (value: unknown) => string;

const stageOrder = ["I", "II", "III", "IV"] as const;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T];
}

const formatters: Record<string, Formatter> = {
  count: (v) => (v == null ? "" : String(v)),
  currency: (v) => (typeof v === "number" ? `$${v.toLocaleString()}` : String(v ?? "")),
  comma_join: (v) => asArray<string>(v).filter(Boolean).join(", "),
  first: (v) => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "")),
  title_case: (v) =>
    String(v ?? "")
      .split(/\s+/)
      .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join(" "),
  lowercase: (v) => String(v ?? "").toLowerCase(),

  weeks: (v) => (typeof v === "number" ? `${v} weeks` : "flexible"),

  stage_phrase: (v) => {
    const arr = asArray<string>(v).filter(Boolean);
    if (arr.length === 0) return "any stage";
    const sorted = [...new Set(arr)].sort(
      (a, b) => stageOrder.indexOf(a as never) - stageOrder.indexOf(b as never),
    );
    if (sorted.length === 1) return `stage ${sorted[0]}`;
    return `stages ${sorted.join("/")}`;
  },

  treatment_phrase: (v) => {
    if (v === "naive") return ", treatment-naive";
    if (v === "treated") return ", previously treated";
    return "";
  },

  budget_band: (v) => {
    if (typeof v !== "number" || v <= 0) return "TBD";
    if (v < 50_000) return "<$50K";
    if (v < 250_000) return "$50K–$250K";
    if (v < 1_000_000) return "$250K–$1M";
    return "$1M+";
  },

  meeting_topic: (v) => `Biospecimen sourcing — ${String(v ?? "intro")}`,

  rfq_bullets: (v) => {
    const specs = asArray<SpecimenRequest>(v);
    if (specs.length === 0) return "";
    return specs
      .map((s) => `${s.n_cases} ${s.type}${s.min_volume_mL ? ` (≥${s.min_volume_mL}mL)` : ""}`)
      .join(", ");
  },
};

export function formatValue(value: unknown, formatName?: string): string {
  if (formatName == null) return value == null ? "" : String(value);
  const fmt = formatters[formatName];
  if (!fmt) {
    throw new Error(
      `Unknown slot format "${formatName}". Register it in src/lib/agents/runtime/formatters.ts.`,
    );
  }
  return fmt(value);
}

export function listFormatters(): string[] {
  return Object.keys(formatters);
}
