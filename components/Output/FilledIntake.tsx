"use client";
// components/Output/FilledIntake.tsx
//
// Renders the Filled Intake §1-8 as a single, scannable document for the
// climax view. Each row shows: label · value · status badge · (optional)
// provenance hovercard pill that clicks through to the chain timeline.
//
// Status badge legend (spec §2):
//   🔒 frozen        buyer's truth, agent never overwrites
//   ✓  confirmed     supplier reply validated buyer's assumption
//   ↻  updated       supplier reality overwrote buyer's preference
//   🤖 agent_filled  computed §7 / §8 row
//   ·  empty         not yet filled

import type { IntakeForm, IntakeField } from "@/types/intake";
import type { SupplierEvidence } from "@/types/evidence";
import type { ChainState } from "@/types/chain";
import { computeSection7 } from "@/lib/intake/section7";
import { computeSection8 } from "@/lib/intake/section8";
import { fixtureIntake, fixtureEvidence, fixtureChain } from "./__fixtures__/intake.fixture";

type SectionGroup = { section: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; title: string; fields: IntakeField[] };

const SECTION_TITLES: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, string> = {
  1: "§1 Identity & Study",
  2: "§2 Purpose & Compliance",
  3: "§3 Specimens",
  4: "§4 Cohort & Eligibility",
  5: "§5 Clinical & Molecular Data",
  6: "§6 Shipping & Supplier Preferences",
  7: "§7 Feasibility (agent-filled)",
  8: "§8 Contract & Close (agent-filled)",
};

function statusBadge(field: IntakeField): { glyph: string; label: string; cls: string } {
  switch (field.status) {
    case "frozen":
      return { glyph: "🔒", label: "Frozen", cls: "fi-badge fi-badge-frozen" };
    case "confirmed":
      return { glyph: "✓", label: "Confirmed", cls: "fi-badge fi-badge-confirmed" };
    case "updated":
      return { glyph: "↻", label: "Updated", cls: "fi-badge fi-badge-updated" };
    case "agent_filled":
      return { glyph: "🤖", label: "Agent-filled", cls: "fi-badge fi-badge-agent" };
    case "empty":
    default:
      return { glyph: "·", label: "Empty", cls: "fi-badge fi-badge-empty" };
  }
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface FilledIntakeProps {
  intake?: IntakeForm;
  evidence?: SupplierEvidence[];
  chain?: ChainState;
  selectedSupplierIds?: string[];
  /**
   * Click handler — parent receives the ChainStageEvent.event_id (== evidence_id)
   * and is expected to toggle the right pane to Lineage mode + scroll to the
   * matching `#event-{id}` anchor.
   */
  onProvenanceClick?: (eventId: string) => void;
}

export function FilledIntake({
  intake = fixtureIntake,
  evidence = fixtureEvidence,
  chain = fixtureChain,
  selectedSupplierIds = ["crovi_bio"],
  onProvenanceClick,
}: FilledIntakeProps) {
  // Compose §7 + §8 inline from the pure helpers.
  const section7 = computeSection7(intake, evidence, selectedSupplierIds);
  const section8 = computeSection8(intake, chain);

  const allFields: IntakeField[] = [...intake.fields, ...section7, ...section8];

  // Group by section.
  const groups: SectionGroup[] = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((s) => ({
    section: s,
    title: SECTION_TITLES[s],
    fields: allFields.filter((f) => f.section === s),
  }));

  const handlePill = (e: React.MouseEvent<HTMLButtonElement>, evidenceId: string) => {
    e.preventDefault();
    if (onProvenanceClick) onProvenanceClick(evidenceId);
  };

  return (
    <article className="fi-doc card-cream" aria-label="Filled Intake document">
      <header className="fi-doc-hd">
        <div className="fi-doc-eyebrow mono">Filled Intake · §1–8</div>
        <h2 className="fi-doc-title serif">
          {intake.buyer.company} × Crovi.bio
        </h2>
        <div className="fi-doc-sub">{intake.fields.find((f) => f.field_id === "study.name")?.value as string}</div>
      </header>

      {groups.map((g) => (
        <section key={g.section} className="fi-section">
          <div className="fi-section-hd mono">{g.title}</div>
          <ul className="fi-rows">
            {g.fields.map((f) => {
              const badge = statusBadge(f);
              const prov = f.provenance;
              return (
                <li key={f.field_id} className="fi-row">
                  <div className="fi-row-label">{f.label}</div>
                  <div className="fi-row-value">{renderValue(f.value)}</div>
                  <div className="fi-row-meta">
                    <span className={badge.cls} title={badge.label} aria-label={badge.label}>
                      <span className="fi-badge-glyph" aria-hidden="true">{badge.glyph}</span>
                      <span className="fi-badge-text">{badge.label}</span>
                    </span>
                    {prov && (
                      <button
                        type="button"
                        className="fi-prov-pill"
                        onClick={(e) => handlePill(e, prov.evidence_id)}
                        title={[
                          `channel: ${prov.channel}`,
                          `supplier: ${prov.supplier_id}`,
                          prov.quote ? `"${prov.quote}"` : null,
                          "click to open lineage",
                        ]
                          .filter(Boolean)
                          .join("\n")}
                        aria-label={`Open provenance — ${prov.channel} from ${prov.supplier_id}`}
                      >
                        <span className="fi-prov-channel mono">{prov.channel}</span>
                        <span className="fi-prov-arrow" aria-hidden="true">→</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </article>
  );
}

export default FilledIntake;
