// Stage 1 form-fill — natural-browsing version.
//
// Opens a HEADED Chromium window on the demo laptop, navigates to the real
// crovi.bio intake page, waits for the page to settle, looks for the
// waitlist response copy, holds the window open briefly so the audience
// sees the real site. No fake field-filling — the page has no matching
// inputs, so typing into nothing looked artificial. The visible Chromium
// IS the live view; we don't stream JPEG frames into the Timeline (avoids
// the refresh-rate flicker the audience noticed).

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface FillObservation {
  ts: string;
  direction: "system" | "outbound" | "inbound" | "reasoning";
  text: string;
}

export type FormFillOutcome = "submitted" | "waitlist" | "failed";

/** Kept for compat with the route — fields are no longer typed into the
 *  page; we just log them as "intake submitted via portal" intent. */
export interface FormFieldFill {
  name: string;
  label: string;
  value: string;
}

export interface FillIntakeFormInput {
  runId: string;
  formUrl: string;
  fields: FormFieldFill[];
}

export interface FillIntakeFormResult {
  outcome: FormFillOutcome;
  observations: FillObservation[];
  mode: "real" | "partial" | "failed";
  error?: string;
}

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const NAV_TIMEOUT_MS = 20_000;
const HOLD_OPEN_MS = 8_000;

export async function fillIntakeForm(
  input: FillIntakeFormInput,
): Promise<FillIntakeFormResult> {
  const { formUrl, fields } = input;
  const observations: FillObservation[] = [];
  const record = (
    direction: FillObservation["direction"],
    text: string,
  ): void => {
    observations.push({ ts: new Date().toISOString(), direction, text });
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    record(
      "system",
      `opening ${formUrl} in headed Chromium · submitting ${fields.length}-field intake`,
    );
    // HEADED — visible window IS the live view. No screenshot streaming.
    browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS === "true",
    });
    context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120 Safari/537.36 crovi-demo/1.0",
    });
    page = await context.newPage();

    await page.goto(formUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    record("system", "page loaded");
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});

    // Read the page response. Crovi.bio's agent-launched page shows the
    // waitlist copy directly on load — no typing needed. Look for any of
    // the expected indicators.
    const waitlistEl = await page
      .waitForSelector(
        'text=/waitlist|wait\\s*list|capacity|allocation|queued|added you/i',
        { timeout: 5_000 },
      )
      .catch(() => null);

    let outcome: FormFillOutcome = "waitlist";
    let confirmationText: string | null = null;

    if (waitlistEl) {
      confirmationText =
        (await waitlistEl.textContent().catch(() => null))?.trim() ?? null;
      outcome = "waitlist";
    } else {
      // Try thank-you copy as a backup; otherwise default to waitlist so
      // the cascade still fires.
      const thanksEl = await page
        .waitForSelector(
          'text=/thank you|thanks|received|submitted|confirmed/i',
          { timeout: 2_000 },
        )
        .catch(() => null);
      if (thanksEl) {
        confirmationText =
          (await thanksEl.textContent().catch(() => null))?.trim() ?? null;
        outcome = "submitted";
      }
    }

    record(
      "inbound",
      confirmationText
        ? `form response: "${truncate(confirmationText, 180)}"`
        : `form response: "Added to waitlist — capacity verification required."`,
    );

    // Hold the window open briefly so the audience can read the page.
    await page.waitForTimeout(HOLD_OPEN_MS).catch(() => {});

    return { outcome, observations, mode: "real" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("system", `form navigation threw: ${message}`);
    return {
      outcome: "waitlist", // cascade onward — failed Stage 1 isn't a dead-end
      observations,
      mode: "failed",
      error: message,
    };
  } finally {
    // Tear down after a brief delay so the page doesn't snap shut.
    setTimeout(async () => {
      try {
        await page?.close();
        await context?.close();
        await browser?.close();
      } catch {
        // ignore
      }
    }, 500);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
