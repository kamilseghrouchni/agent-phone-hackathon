// DEPRECATED — Stage 1 no longer drives Playwright.
//
// The chain runtime (app/api/chain/start/route.ts) now fast-paths Stage 1
// straight to "waitlist" and cascades into Stage 2. The Enrich phase
// already showed a live headless Chromium scraping crovi.bio — opening a
// SECOND Chromium for "form-fill" was redundant and blocked the call
// cascade for ~30s+ per run.
//
// This file is kept only because `fillIntakeForm` may still be referenced
// by older route paths or e2e scripts. New code MUST NOT import it. Delete
// after the next demo cycle once we're sure nothing else depends on it.

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
const HOLD_OPEN_MS = 30_000;

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

    // Build the query from the field bag — the audience needs to see real
    // text typed, not silence. Prefer an explicit `query` field; otherwise
    // synthesize a one-line summary from the intake fields.
    const query = buildQueryString(fields);
    if (query) {
      const typed = await tryTypeQuery(page, query, record);
      if (typed) {
        // Give the page a beat to react (search debounce / SPA navigation).
        await page.waitForTimeout(1_500).catch(() => {});
      }
    } else {
      record("system", "no query content available — skipping type step");
    }

    // Read the page response. Crovi.bio's agent-launched page shows the
    // waitlist copy directly on load (or post-submit) — look for any of
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

/**
 * Compose a one-line query from the field bag for typing into the page.
 * Prefers explicit query/indication/specimen fields; falls back to the
 * concatenation of all non-empty values.
 */
function buildQueryString(fields: FormFieldFill[]): string {
  if (!fields.length) return "";
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.value]));
  const preferred = [
    byName.get("query"),
    byName.get("indication"),
    byName.get("disease"),
    byName.get("condition"),
    byName.get("specimen") ?? byName.get("specimen_types"),
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (preferred.length) return preferred.join(" · ").slice(0, 240);
  const all = fields
    .map((f) => String(f.value ?? "").trim())
    .filter((v) => v.length > 0);
  return all.join(" · ").slice(0, 240);
}

/**
 * Locate the most likely search/text input on the page and type the query
 * into it. Tries multiple selectors so we work across SPA shells. Returns
 * true when text was typed (whether or not the page reacted), false when
 * nothing typable was found within the timeout.
 */
async function tryTypeQuery(
  page: Page,
  query: string,
  record: (d: FillObservation["direction"], t: string) => void,
): Promise<boolean> {
  const selectors = [
    'input[type="search"]:visible',
    'input[name*="query" i]:visible',
    'input[placeholder*="search" i]:visible',
    'input[placeholder*="ask" i]:visible',
    'input[placeholder*="describe" i]:visible',
    'textarea:visible',
    'input[type="text"]:visible',
  ];
  for (const sel of selectors) {
    const el = await page
      .waitForSelector(sel, { timeout: 1_500, state: "visible" })
      .catch(() => null);
    if (!el) continue;
    try {
      await el.click({ timeout: 1_000 }).catch(() => {});
      await el.fill("", { timeout: 1_000 }).catch(() => {});
      // type() (not fill()) so the page sees real keystroke events — many
      // SPAs gate their submit handler on `input` rather than `change`.
      await el.type(query, { delay: 18 });
      record("outbound", `typed query: "${truncate(query, 160)}"`);
      // Attempt submit — first Enter, then a nearby submit button if any.
      await el.press("Enter").catch(() => {});
      const submitBtn = await page
        .waitForSelector(
          'button:has-text("Search"), button:has-text("Submit"), button[type="submit"]',
          { timeout: 1_000, state: "visible" },
        )
        .catch(() => null);
      if (submitBtn) {
        await submitBtn.click({ timeout: 1_000 }).catch(() => {});
        record("outbound", "clicked submit");
      }
      return true;
    } catch {
      // try the next selector
    }
  }
  record(
    "system",
    "no input field found on page — leaving query untyped (waitlist response will still be read)",
  );
  return false;
}
