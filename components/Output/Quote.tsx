"use client";
// components/Output/Quote.tsx
//
// Single-page Crovi.bio procurement quote.
// All numbers are hand-authored, hardcoded per the spec — do not parameterize.

export interface QuoteProps {
  /** Optional override for the Sponge transfer id rendered in the terms strip. */
  spongeTransferId?: string;
  /** @deprecated Pre-swap alias retained for callers that still pass stripeTransferId. */
  stripeTransferId?: string;
}

export function Quote({ spongeTransferId, stripeTransferId }: QuoteProps) {
  const transferId = spongeTransferId ?? stripeTransferId;
  // Line items — locked numbers (spec §6 V6.2 + climax view).
  const PLASMA_UNIT = 850;
  const FFPE_UNIT = 1150;
  const SLIDE_UNIT = 700;

  const PLASMA_QTY = 150;
  const FFPE_QTY = 75;
  const SLIDE_QTY = 0; // included as optional in scope line; not priced into total.

  const TOTAL = 213_750; // locked total
  const BENCHMARK_MEDIAN = 950; // industry median per case
  const BENCHMARK_N = 18;
  const BENCHMARK_DELTA_PCT = 11; // crovi.bio is 11% below benchmark

  return (
    <article className="qt-doc card-cream" aria-label="Crovi.bio procurement quote">
      <header className="qt-hd">
        <div className="qt-eyebrow mono">Crovi.bio · Procurement Quote</div>
        <h2 className="qt-title serif">NSCLC Liquid Biopsy Validation Study</h2>
        <div className="qt-scope">
          150 plasma + 75 matched FFPE/slides · Stage III–IV NSCLC · EGFR/KRAS/ALK enriched
        </div>
      </header>

      <section className="qt-section">
        <div className="qt-section-hd mono">Per-sample pricing</div>
        <table className="qt-table">
          <thead>
            <tr>
              <th>Specimen</th>
              <th className="right">Unit price</th>
              <th className="right">Quantity</th>
              <th className="right">Line total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Plasma (≥2 mL, frozen −80°C)</td>
              <td className="right mono">${PLASMA_UNIT.toLocaleString()}</td>
              <td className="right mono">{PLASMA_QTY}</td>
              <td className="right mono">${(PLASMA_UNIT * PLASMA_QTY).toLocaleString()}</td>
            </tr>
            <tr>
              <td>FFPE block (matched)</td>
              <td className="right mono">${FFPE_UNIT.toLocaleString()}</td>
              <td className="right mono">{FFPE_QTY}</td>
              <td className="right mono">${(FFPE_UNIT * FFPE_QTY).toLocaleString()}</td>
            </tr>
            <tr>
              <td>Slide set (optional)</td>
              <td className="right mono">${SLIDE_UNIT.toLocaleString()}</td>
              <td className="right mono">{SLIDE_QTY}</td>
              <td className="right mono">$0</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="right qt-total-label">Total</td>
              <td className="right qt-total mono">${TOTAL.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="qt-section">
        <div className="qt-section-hd mono">Market benchmark</div>
        <div className="qt-bench">
          <div className="qt-bench-line">
            Industry median <span className="mono">${BENCHMARK_MEDIAN}</span> per case
            <span className="qt-bench-n mono"> (n={BENCHMARK_N})</span>
          </div>
          <div className="qt-bench-delta">
            <span className="qt-bench-tag mono">Crovi.bio</span>
            <span className="qt-bench-pct">−{BENCHMARK_DELTA_PCT}%</span>
            <span className="qt-bench-note">below benchmark</span>
          </div>
        </div>
      </section>

      <section className="qt-section">
        <div className="qt-section-hd mono">Terms</div>
        <ul className="qt-terms">
          <li><strong>Payment.</strong> 50% upfront on contract execution; balance net-30 after final shipment.</li>
          <li><strong>Logistics.</strong> Weekly batch shipments. IATA-compliant courier. −80°C plasma, ambient FFPE.</li>
          <li><strong>Compliance.</strong> CAP/CLIA certified lab. De-identified path reports + clinical history included.</li>
          <li><strong>Validity.</strong> 30 days from issue.</li>
        </ul>
      </section>

      <section className="qt-section qt-down">
        <div className="qt-section-hd mono">Down payment — goodwill</div>
        <div className="qt-down-row">
          <span className="qt-down-amount serif">$10</span>
          <span className="qt-down-label">Goodwill down payment via Sponge locks supplier allocation.</span>
        </div>
        {transferId && (
          <div className="qt-down-txn mono">Sponge txn · {transferId}</div>
        )}
      </section>

      <footer className="qt-foot mono">
        Issued {new Date().toISOString().slice(0, 10)} · Valid 30 days · bd@crovi.bio
      </footer>
    </article>
  );
}

export default Quote;
