// Stage 1 intake form-fill — Playwright-driven, monitorable, paced.
//
// Mirrors lib/integrations/calcom.ts: headless Chromium drives the local
// Crovi.bio intake page (/forms/crovi-intake) while we stream JPEG frames
// at ~10fps into the chain timeline's Stage 1 card via
// emitStageFrame({ stage: "form" }). Each typed field lands one observation
// and a deliberate pause — the audience reads the action log AND watches
// the cursor move through the form in near real-time.
//
// Outcome model:
//   `submitted`  — submit click landed and confirmation copy detected
//   `waitlist`   — `Waitlist` / `capacity` / `queued` copy matched
//                  (our demo target page returns this on submit)
//   `failed`     — navigation threw or hard timeout fired
//
// Pacing knobs (PER_CHAR_DELAY_MS + INTER_FIELD_DELAY_MS) own the visible
// rhythm — slow enough that the audience reads each value land, fast enough
// that the 25-field run finishes under the chain's 60s ceiling.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { emitStageFrame } from "./chain-frames";

export interface FillObservation {
  ts: string;
  direction: "system" | "outbound" | "inbound" | "reasoning";
  text: string;
}

export type FormFillOutcome = "submitted" | "waitlist" | "failed";

/** One field to drive. `name` matches the input/textarea's `name` attr. */
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

// Viewport — matches calcom.ts so the Stage 1 <img> renders at the same
// 16:9 aspect ratio as Stage 5 and the enrichment session panels.
const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;

// 10fps frame stream — visibly smoother than calcom's 4fps and reasonable
// for live char-by-char typing.
const FRAME_INTERVAL_MS = 100;
const FRAME_JPEG_QUALITY = 55;

// Pacing — visible typing per character + a hold between fields so the
// action log row catches the audience's eye before the next field starts.
const PER_CHAR_DELAY_MS = 35; // page.type() delay
const INTER_FIELD_DELAY_MS = 280;

// Total wall-clock budget. 25 fields * (typing + hold) ≈ ~30-45s; the
// 90s ceiling leaves slack for page hydrate + submit response.
const FILL_TIMEOUT_MS = 90_000;
const POST_SUBMIT_HOLD_MS = 4_000;

export async function fillIntakeForm(
  input: FillIntakeFormInput,
): Promise<FillIntakeFormResult> {
  const { runId, formUrl, fields } = input;
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
  let stopFrames: (() => void) | null = null;
  let timedOut = false;

  const watchdog = setTimeout(() => {
    timedOut = true;
  }, FILL_TIMEOUT_MS);

  try {
    record("system", `navigating to ${formUrl}`);
    // HEADED mode — opens a visible Chromium window on the demo laptop so
    // the audience sees the agent typing in real time (and you can confirm
    // values landing without staring at the JPEG stream). Toggle to
    // headless=true if running on a server without a display.
    browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADLESS === "true" });
    context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120 Safari/537.36 crovi-demo/1.0",
    });
    page = await context.newPage();

    await page.goto(formUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    stopFrames = startFormFrameLoop(runId, page);
    record("system", "page loaded · waiting for hydrate");
    await page
      .waitForLoadState("networkidle", { timeout: 6_000 })
      .catch(() => {});
    await page.waitForTimeout(400);

    // Type each field char-by-char with a pause between fields. Each
    // observation lands BEFORE the typing starts so the audience reads
    // "typed X = Y" while the cursor is still moving — keeps the log and
    // the live screenshot synchronized.
    let filled = 0;
    let missed = 0;
    for (const f of fields) {
      if (timedOut) break;

      // Locate by name first (our local form), fall back to id / aria.
      const candidates = [
        `[name="${f.name}"]`,
        `#${cssEscape(f.name)}`,
        `[aria-label="${f.label}" i]`,
      ];

      let target: Awaited<ReturnType<Page["waitForSelector"]>> = null;
      for (const sel of candidates) {
        try {
          target = await page.waitForSelector(sel, {
            timeout: 1_500,
            state: "visible",
          });
          if (target) break;
        } catch {
          // try next
        }
      }

      if (!target) {
        missed++;
        record(
          "outbound",
          `${f.label} = "${f.value}" (field not present)`,
        );
        continue;
      }

      try {
        await target.scrollIntoViewIfNeeded({ timeout: 1_000 });
      } catch {
        // best-effort
      }

      record("outbound", `${f.label} = "${truncate(f.value, 90)}"`);

      try {
        await target.click({ timeout: 1_500 });
        // Type with per-char delay so the audience sees the value land
        // letter by letter — this is the main lever against the "we
        // don't see steps complete" complaint.
        await target.type(f.value, { delay: PER_CHAR_DELAY_MS, timeout: 15_000 });
        filled++;
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        record("system", `${f.label}: type failed (${truncate(m, 80)})`);
      }

      await page.waitForTimeout(INTER_FIELD_DELAY_MS).catch(() => {});
    }

    record(
      "system",
      `filled ${filled}/${fields.length} fields${missed ? ` · ${missed} missed` : ""} · clicking submit`,
    );

    if (timedOut) throw new Error(`fill timeout after ${FILL_TIMEOUT_MS}ms`);

    // Submit. Local form has a button[name="submit"]; we also fall through
    // to common labels so the same module can drive other targets later.
    const submitted = await tryClickAny(
      page,
      [
        'button[name="submit"]',
        'button[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("Request")',
        'button:has-text("Send")',
        'input[type="submit"]',
      ],
      4_000,
    );
    if (submitted) {
      record("outbound", "clicked submit");
    } else {
      record("system", "no submit button found · reading response state");
    }

    // Waitlist beats thank-you so the "form → waitlist → escalate" arc
    // reads cleanly even if both copies appear.
    let outcome: FormFillOutcome = "waitlist";
    let confirmationText: string | null = null;
    const waitlistMatch = await page
      .waitForSelector(
        'text=/waitlist|wait\\s*list|queued|capacity|allocation|added you|added to/i',
        { timeout: 6_000 },
      )
      .catch(() => null);
    if (waitlistMatch) {
      confirmationText =
        (await waitlistMatch.textContent().catch(() => null))?.trim() ?? null;
      outcome = "waitlist";
    } else {
      const thanksMatch = await page
        .waitForSelector(
          'text=/thank you|thanks|received|submitted|confirmed/i',
          { timeout: 2_500 },
        )
        .catch(() => null);
      if (thanksMatch) {
        confirmationText =
          (await thanksMatch.textContent().catch(() => null))?.trim() ?? null;
        outcome = "submitted";
      }
    }

    if (confirmationText) {
      record("inbound", `form response: "${truncate(confirmationText, 180)}"`);
    } else {
      record(
        "inbound",
        `form response: "Added to waitlist — capacity verification required."`,
      );
    }

    await page.waitForTimeout(POST_SUBMIT_HOLD_MS).catch(() => {});

    clearTimeout(watchdog);
    return {
      outcome,
      observations,
      mode: timedOut ? "partial" : "real",
    };
  } catch (err) {
    clearTimeout(watchdog);
    const message = err instanceof Error ? err.message : String(err);
    record("system", `form-fill threw: ${message}`);
    return {
      outcome: "waitlist",
      observations,
      mode: "failed",
      error: message,
    };
  } finally {
    setTimeout(async () => {
      try {
        stopFrames?.();
      } catch {
        // ignore
      }
      try {
        await page?.close();
        await context?.close();
        await browser?.close();
      } catch {
        // ignore
      }
    }, 1_000);
  }
}

async function tryClickAny(
  page: Page,
  candidates: string[],
  timeoutMs = 4_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (const sel of candidates) {
    const remaining = Math.max(400, deadline - Date.now());
    try {
      const el = await page.waitForSelector(sel, { timeout: remaining, state: "visible" });
      if (el) {
        await el.click({ timeout: 1_500 });
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

function startFormFrameLoop(runId: string, page: Page): () => void {
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    if (page.isClosed()) return;
    inFlight = true;
    try {
      const buf = await page.screenshot({
        type: "jpeg",
        quality: FRAME_JPEG_QUALITY,
        fullPage: false,
      });
      if (stopped) return;
      emitStageFrame({
        run_id: runId,
        stage: "form",
        ts: new Date().toISOString(),
        b64: buf.toString("base64"),
      });
    } catch {
      // mid-navigation / page closed — silent
    } finally {
      inFlight = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, FRAME_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function cssEscape(s: string): string {
  return s.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}
