/**
 * Anomaly computer — derives candidate signals from a QuerySpecimensResult
 * for the narrator to pick from. Pure function, no LLM.
 *
 * Signals are ranked by `weight` (higher = more interesting).
 */
import type { QuerySpecimensResult } from "../tools/query_specimens";
import type { SpecimenFilters } from "../filters";

export type AnomalyCandidate = {
  fact: string;
  weight: number;
};

export function computeAnomalies(result: QuerySpecimensResult): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  const { totals, institutes, groupings, filters_applied } = result;

  if (totals.specimens === 0) {
    out.push({ fact: "No commercial specimens match this query.", weight: 100 });
    return out;
  }

  if (totals.institutes <= 2) {
    out.push({
      fact: `Only ${totals.institutes} institute${totals.institutes === 1 ? "" : "s"} match — concentration risk.`,
      weight: 70,
    });
  }

  const byCountry = Object.entries(groupings.by_country ?? {}).sort((a, b) => b[1].count - a[1].count);
  if (byCountry.length > 0 && totals.specimens > 0) {
    const [topCountry, topData] = byCountry[0];
    const share = topData.count / totals.specimens;
    if (share >= 0.5 && byCountry.length > 1) {
      out.push({
        fact: `${topCountry} holds ${Math.round(share * 100)}% of matching specimens (${byCountry.length} countries total).`,
        weight: 60,
      });
    } else if (byCountry.length === 1) {
      out.push({
        fact: `All matching specimens are in ${topCountry}.`,
        weight: 65,
      });
    }
  }

  const withContact = institutes.filter((i) => !!i.contact_email).length;
  if (institutes.length > 0) {
    if (withContact === institutes.length) {
      out.push({
        fact: `All ${institutes.length} institutes have direct contact emails on file.`,
        weight: 30,
      });
    } else if (withContact === 0) {
      out.push({
        fact: `None of the ${institutes.length} institutes have direct contact emails.`,
        weight: 55,
      });
    } else if (withContact / institutes.length < 0.5) {
      out.push({
        fact: `Only ${withContact} of ${institutes.length} institutes have direct contacts.`,
        weight: 45,
      });
    }
  }

  if (filters_applied.longitudinal) {
    if (totals.longitudinal_donors === 0) {
      out.push({ fact: "No longitudinal donors in the matching set.", weight: 75 });
    } else {
      const longShare = totals.donors > 0 ? totals.longitudinal_donors / totals.donors : 0;
      const topInstByLong = [...institutes].sort(
        (a, b) => b.longitudinal_donor_count - a.longitudinal_donor_count
      )[0];
      if (topInstByLong && totals.longitudinal_donors > 0) {
        const instShare =
          topInstByLong.longitudinal_donor_count / Math.max(totals.longitudinal_donors, 1);
        if (instShare >= 0.5 && institutes.length > 1) {
          out.push({
            fact: `${topInstByLong.name} holds ${Math.round(instShare * 100)}% of longitudinal donors (${totals.longitudinal_donors} total).`,
            weight: 55,
          });
        } else {
          out.push({
            fact: `${totals.longitudinal_donors} of ${totals.donors} donors are longitudinal (${Math.round(longShare * 100)}%).`,
            weight: 35,
          });
        }
      }
    }
  }

  if (filters_applied.matched_pairs_required) {
    const matched = institutes.reduce((acc, i) => acc + (i.matched_pair_donor_count ?? 0), 0);
    if (matched === 0) {
      out.push({ fact: "No matched-pair donors in the matching set.", weight: 70 });
    } else {
      const topInst = [...institutes].sort(
        (a, b) => (b.matched_pair_donor_count ?? 0) - (a.matched_pair_donor_count ?? 0)
      )[0];
      if (topInst) {
        const share = (topInst.matched_pair_donor_count ?? 0) / Math.max(matched, 1);
        if (share >= 0.5 && institutes.length > 1) {
          out.push({
            fact: `${topInst.name} holds ${Math.round(share * 100)}% of matched-pair donors (${matched} total).`,
            weight: 55,
          });
        }
      }
    }
  }

  if (filters_applied.min_n != null) {
    const meeting = institutes.filter((i) => i.donor_count >= (filters_applied.min_n ?? 0)).length;
    if (meeting === 0) {
      out.push({
        fact: `No single institute meets the ≥${filters_applied.min_n} donor threshold — multi-site sourcing required.`,
        weight: 65,
      });
    } else if (meeting === 1) {
      out.push({
        fact: `Only 1 institute clears ≥${filters_applied.min_n} donors on its own.`,
        weight: 50,
      });
    }
  }

  const bySpecimen = Object.entries(groupings.by_specimen_type ?? {}).sort((a, b) => b[1] - a[1]);
  if (bySpecimen.length >= 2 && totals.specimens > 0) {
    const [topType, topCount] = bySpecimen[0];
    const share = topCount / totals.specimens;
    if (share >= 0.7) {
      out.push({
        fact: `${Math.round(share * 100)}% of matching specimens are ${topType}.`,
        weight: 25,
      });
    }
  }

  if (institutes.length > 0) {
    const topInst = [...institutes].sort((a, b) => b.donor_count - a.donor_count)[0];
    const totalDonors = institutes.reduce((acc, i) => acc + i.donor_count, 0);
    if (topInst && totalDonors > 0 && institutes.length > 1) {
      const share = topInst.donor_count / totalDonors;
      if (share >= 0.4) {
        out.push({
          fact: `${topInst.name} holds ${Math.round(share * 100)}% of donors across the matching set.`,
          weight: 40,
        });
      }
    }
  }

  out.sort((a, b) => b.weight - a.weight);
  return out.slice(0, 5);
}

/** Deterministic narration to use when the LLM call is skipped or fails. */
export function fallbackNarration(
  anomalies: AnomalyCandidate[],
  totals: { specimens: number; donors: number; institutes: number },
): string {
  if (anomalies.length === 0) {
    if (totals.specimens === 0) return "No specimens matched the filters as stated.";
    return `${totals.institutes} institutes — ${totals.specimens.toLocaleString()} specimens, ${totals.donors.toLocaleString()} donors.`;
  }
  return anomalies[0].fact;
}
