// Stage 5 calendar booking — Playwright-driven Notion calendar.
//
// File name is preserved (callers like chain-transitions.ts reference it),
// but the implementation no longer talks to Cal.com REST. Instead we drive
// the Notion calendar URL configured in DEMO_CALL_TARGET_CALENDAR_URL with
// a HEADLESS Chromium and live-stream JPEG frames into the chain timeline's
// Stage 5 card via the per-runId frame bus (see emitStageFrame below). The
// audience watches the booking land INSIDE the platform UI — no separate OS
// window.
//
// Selector philosophy: Notion's calendar booking page is a SPA whose DOM
// shifts between releases. We rely on resilient signals — button text
// matches ("Book"/"Schedule"/"Confirm"/"Next"), input placeholders ("Name",
// "Email"), and generic ARIA roles — and degrade to a `partial` result
// rather than throwing if a selector misses. The page is held open ~5s
// after success so the confirmation frame stays on screen.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { emitStageFrame } from "./chain-frames";

// ───────────────────────────────────────────────────────────────────────────
// Public types — keep `bookSlot` signature stable for chain-transitions.ts.
// ───────────────────────────────────────────────────────────────────────────

export interface BookSlotInput {
  runId: string;
  supplierId: string;
  attendeeName: string;
  attendeeEmail: string;
  agenda: string;
}

export interface BookSlotResult {
  ok: boolean;
  event_id?: string;
  scheduled_for?: string;
  error?: string;
  mode: "real" | "missing_env" | "partial";
}

export function meetingBookingConfigured(): boolean {
  return Boolean(process.env.DEMO_CALL_TARGET_CALENDAR_URL);
}

// ───────────────────────────────────────────────────────────────────────────
// Viewport — matches browser-use.ts so the chain-timeline's Stage 5 <img>
// renders at the same 16:9 aspect ratio as the enrichment session panels.
// ───────────────────────────────────────────────────────────────────────────

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const FRAME_INTERVAL_MS = 250; // ~4 fps
const FRAME_JPEG_QUALITY = 50;

// Total wall-clock budget for the booking attempt. Notion's calendar SPA
// can be slow to hydrate; the 60s ceiling gives the slot picker time to
// resolve while still bounding stage time.
const BOOKING_TIMEOUT_MS = 60_000;

// ───────────────────────────────────────────────────────────────────────────
// Selector helpers — every probe is best-effort. A miss flips us to
// `partial` mode rather than aborting.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Click the first visible element matching any of the candidate locators.
 * Returns true if a click landed.
 */
async function tryClickAny(page: Page, candidates: string[], timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (const sel of candidates) {
    const remaining = Math.max(500, deadline - Date.now());
    try {
      const el = await page.waitForSelector(sel, { timeout: remaining, state: "visible" });
      if (el) {
        await el.click({ timeout: 2_000 });
        return true;
      }
    } catch {
      // try next candidate
    }
  }
  return false;
}

async function tryFillAny(
  page: Page,
  candidates: string[],
  value: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (const sel of candidates) {
    const remaining = Math.max(500, deadline - Date.now());
    try {
      const el = await page.waitForSelector(sel, { timeout: remaining, state: "visible" });
      if (el) {
        await el.fill(value, { timeout: 2_000 });
        return true;
      }
    } catch {
      // try next candidate
    }
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
// bookSlot — main entry. Same name as the prior Cal.com REST helper.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Drive the Notion calendar booking page in a HEADED Chromium window:
 * navigate → pick an available slot → fill name/email/agenda → submit.
 * Audience watches it happen on the demo laptop.
 *
 * Returns `mode: "missing_env"` if DEMO_CALL_TARGET_CALENDAR_URL is unset,
 * `mode: "real"` on a clean booking, and `mode: "partial"` if some step
 * couldn't find its selector — the page is still left open so the operator
 * can manually finish if needed.
 */
export async function bookSlot(input: BookSlotInput): Promise<BookSlotResult> {
  const calendarUrl = process.env.DEMO_CALL_TARGET_CALENDAR_URL;
  if (!calendarUrl) {
    return {
      ok: false,
      mode: "missing_env",
      error:
        "DEMO_CALL_TARGET_CALENDAR_URL missing. Set the Notion calendar URL in .env.local.",
    };
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let stopFrames: (() => void) | null = null;
  let partial = false;
  const issues: string[] = [];
  const startedAt = new Date().toISOString();

  // Watchdog — guarantees we never hang the chain runtime.
  const watchdog = setTimeout(() => {
    issues.push(`hard timeout after ${BOOKING_TIMEOUT_MS}ms`);
    partial = true;
  }, BOOKING_TIMEOUT_MS);

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120 Safari/537.36 crovi-demo/1.0",
    });
    page = await context.newPage();

    await page.goto(calendarUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });

    // Start streaming JPEG frames into the chain timeline's Stage 5 card.
    stopFrames = startCalendarFrameLoop(input.runId, page);
    // Give Notion's SPA a beat to hydrate the calendar grid.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    // 1. Pick an available slot. Notion's calendar exposes available times
    //    as clickable buttons; we try generic time-style labels first, then
    //    fall back to any button that looks like a slot.
    const slotPicked = await tryClickAny(
      page,
      [
        // Common Notion calendar slot button shapes.
        'button[data-testid*="time"]',
        'button[aria-label*="AM" i]',
        'button[aria-label*="PM" i]',
        'button:has-text(":00 AM")',
        'button:has-text(":30 AM")',
        'button:has-text(":00 PM")',
        'button:has-text(":30 PM")',
        // Generic fallback — first non-disabled scheduling button.
        'div[role="button"]:not([aria-disabled="true"]):has-text(":")',
      ],
      8_000,
    );
    if (!slotPicked) {
      partial = true;
      issues.push("no available slot button matched");
    }

    // 2. Advance through any intermediate step (Notion sometimes shows a
    //    "Next" / "Continue" gate before the attendee form).
    await tryClickAny(
      page,
      [
        'button:has-text("Next")',
        'button:has-text("Continue")',
      ],
      2_000,
    ).catch(() => false);

    // Let the attendee form mount.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

    // 3. Fill name.
    const nameFilled = await tryFillAny(
      page,
      [
        'input[name="name"]',
        'input[placeholder*="Name" i]',
        'input[aria-label*="Name" i]',
        'input[type="text"]',
      ],
      input.attendeeName,
      4_000,
    );
    if (!nameFilled) {
      partial = true;
      issues.push("name field not found");
    }

    // 4. Fill email.
    const emailFilled = await tryFillAny(
      page,
      [
        'input[name="email"]',
        'input[type="email"]',
        'input[placeholder*="Email" i]',
        'input[aria-label*="Email" i]',
      ],
      input.attendeeEmail,
      4_000,
    );
    if (!emailFilled) {
      partial = true;
      issues.push("email field not found");
    }

    // 5. Try to fill an agenda/notes textarea if one exists. Non-fatal.
    await tryFillAny(
      page,
      [
        'textarea[name="notes"]',
        'textarea[placeholder*="Note" i]',
        'textarea[placeholder*="Agenda" i]',
        'textarea[aria-label*="Note" i]',
        'textarea',
      ],
      input.agenda,
      2_000,
    ).catch(() => false);

    // 6. Submit. Try the most specific labels first.
    const submitted = await tryClickAny(
      page,
      [
        'button:has-text("Book")',
        'button:has-text("Schedule")',
        'button:has-text("Confirm")',
        'button:has-text("Reserve")',
        'button[type="submit"]',
      ],
      5_000,
    );
    if (!submitted) {
      partial = true;
      issues.push("submit button not found");
    }

    // 7. Wait briefly for the confirmation state, then hold the page open
    //    so the audience can see it land.
    await page
      .waitForSelector(
        'text=/Confirmed|Booked|Scheduled|Thanks|Thank you|See you/i',
        { timeout: 8_000 },
      )
      .catch(() => {
        partial = true;
        issues.push("confirmation copy not detected");
      });

    // Keep the window visible for ~5s after submit.
    await page.waitForTimeout(5_000).catch(() => {});

    clearTimeout(watchdog);

    const result: BookSlotResult = {
      ok: !partial,
      event_id: `notion-cal:${input.runId}:${Date.now()}`,
      scheduled_for: startedAt,
      mode: partial ? "partial" : "real",
    };
    if (partial && issues.length > 0) {
      result.error = `Notion calendar booking partial: ${issues.join("; ")}`;
    }
    return result;
  } catch (err) {
    clearTimeout(watchdog);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      mode: "partial",
      error: `Notion calendar booking threw: ${message}`,
      scheduled_for: startedAt,
    };
  } finally {
    // Tear down on a delay so the confirmation frame stays visible briefly
    // in the Stage 5 card. The frame loop is stopped first to avoid
    // screenshot calls on a closing page.
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

/**
 * Screenshot loop for the Notion calendar booking page. Emits a per-runId
 * `stage_frame` for stage="meeting" at ~4 fps, JPEG quality 50, viewport-
 * only. Errors during navigation transitions are swallowed silently — the
 * next tick reuses the latest successful frame.
 */
function startCalendarFrameLoop(runId: string, page: Page): () => void {
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
        stage: "meeting",
        ts: new Date().toISOString(),
        b64: buf.toString("base64"),
      });
    } catch {
      // mid-navigation / target closed — silent, try next tick
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
