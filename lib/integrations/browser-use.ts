// Browser Use integration — LOCAL Playwright HEADLESS Chromium.
//
// Audience sees a live JPEG frame stream rendered INSIDE each supplier's
// SessionPanel (no separate OS windows). We launch Chromium with
// `headless: true`, run a screenshot loop at ~4 fps, JPEG quality 50,
// viewport-only (~1280×720), and emit a `frame` event per tick into an
// in-memory bus that the SSE endpoint forwards to the UI.
//
// Run `npx playwright install chromium` once.
//
// Two surfaces:
//   1. submitForm()   — Stage 1 form-fill path (still a stub locally; see
//                       lib/agents/runtime/chain-runtime.ts TODO for the
//                       frame-stream channel reservation).
//   2. startSession() — V1 enrichment: launches headless Chromium pointed at
//                       a supplier URL, runs a per-supplier scrape script,
//                       streams an in-memory action log + frame stream, and
//                       writes extracted fields back to the handle.

import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { BiobankOpportunity } from "@/types/biobank";
import { resolveDestination, demoModeActive } from "./demo-mode";
import { loadRefMed } from "@/lib/search/refmed-loader";

// ───────────────────────────────────────────────────────────────────────────
// Public types — names + shapes are preserved from the cloud version so
// the rest of the codebase (enrich.ts, components/Enrich/*, evidence pool)
// keeps working without changes.
// ───────────────────────────────────────────────────────────────────────────

export const SESSION_HARD_TIMEOUT_MS = 60_000;

export type BrowserSessionStatus =
  | "starting"
  | "live"
  | "running"
  | "complete"
  | "partial"
  | "failed"
  | "timed_out"
  | "timeout";

export interface ActionEvent {
  /** ISO timestamp. */
  t: string;
  /** "navigate" | "wait" | "extract" | "fallback" | "error" | "info" */
  kind: "navigate" | "wait" | "extract" | "fallback" | "error" | "info";
  /** Short human-readable text shown in the action log. */
  text: string;
}

/** 8 extractable fields per supplier — spec § 4 Beat 3. */
export interface ExtractedFields {
  contact_email?: string;
  contact_phone?: string;
  contact_bd_name?: string;
  claimed_conditions?: string[];
  sample_types?: string[];
  public_catalog_url?: string;
  geography?: string;
  intake_form_url?: string;
  /**
   * RefMed-only theatrical beat. Populated mid-scrape after the agent
   * "downloads" the XLSX (the file is already in memory — the scrape just
   * pauses long enough for the action log to narrate the discovery). Drives
   * the inventory tag on the RefMed supplier card.
   */
  inventory_loaded?: {
    case_count: number;
    specimen_count: number;
    top_indications: string[];
  };
  /** Raw "best effort" page text we kept around for fallback evidence. */
  notes?: string;
}

export interface BrowserSessionHandle {
  /** Kept for evidence_id stability — schema didn't move. */
  session_id: string;
  /** Local mode has no task id; kept null for shape parity. */
  task_id: string | null;
  /** Local mode has no remote live view; kept null for shape parity. */
  live_view_url: string | null;
  supplier_id: string;
  target_url: string;
  status: BrowserSessionStatus;
  started_at: string;
  completed_at?: string;
  /** Streamed action log; mirrored over SSE to the UI. */
  action_log: ActionEvent[];
  /** Fields the scrape pulled out so far; UI fills in live. */
  extracted: ExtractedFields;
  /** Free-text output (final summary). */
  output?: string;
  error?: string;
  mode: "local";
}

interface StartSessionInput {
  supplier_id: string;
  /** Hand-written target URL; defaults wired in per-supplier below. */
  target_url?: string;
  /** Kept for shape parity with the cloud version — ignored locally. */
  task?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory registries — STASHED ON globalThis so dev-mode hot reload + the
// fact that route modules can re-import this file don't create *separate*
// EventEmitter instances on the publisher and subscriber sides. (Same pattern
// as lib/integrations/payment-events.ts.)
// ───────────────────────────────────────────────────────────────────────────

interface BrowserUseGlobals {
  sessions: Map<string, BrowserSessionHandle>;
  sessionsBySupplier: Map<string, string>;
  pages: Map<string, { browser: Browser; context: BrowserContext; page: Page }>;
  bus: EventEmitter;
  lastFrame: Map<string, FrameEvent>;
  /**
   * Per-supplier frame-loop stoppers. Indexed by supplier_id (not session_id)
   * so a new run for the same supplier can KILL the prior frame loop before
   * launching a fresh one. Prevents indefinite frame emit-leaks across hot
   * reloads and back-to-back enrich runs.
   */
  frameStoppers: Map<string, () => void>;
}

const GLOBAL_KEY = "__crovi_browser_use__";

function getGlobals(): BrowserUseGlobals {
  const g = globalThis as unknown as Record<string, BrowserUseGlobals | undefined>;
  if (!g[GLOBAL_KEY]) {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    g[GLOBAL_KEY] = {
      sessions: new Map(),
      sessionsBySupplier: new Map(),
      pages: new Map(),
      bus,
      lastFrame: new Map(),
      frameStoppers: new Map(),
    };
  }
  return g[GLOBAL_KEY] as BrowserUseGlobals;
}

const SESSIONS = getGlobals().sessions;
const SESSIONS_BY_SUPPLIER = getGlobals().sessionsBySupplier;
const PAGES = getGlobals().pages;
const BUS = getGlobals().bus;

/** Latest frame per supplier — emit-and-forget, latest-frame-wins. */
const LAST_FRAME = getGlobals().lastFrame;
const FRAME_STOPPERS = getGlobals().frameStoppers;

const DEBUG = process.env.DEBUG === "1" || process.env.NODE_ENV !== "production";
function dlog(...args: unknown[]): void {
  if (DEBUG) console.log("[browser-use]", ...args);
}

export interface FrameEvent {
  supplier_id: string;
  /** ISO timestamp of capture. */
  ts: string;
  /** Base64-encoded JPEG (no data: prefix). */
  b64: string;
}

export function getSession(sessionId: string): BrowserSessionHandle | undefined {
  return SESSIONS.get(sessionId);
}

export function getSessionBySupplier(
  supplierId: string,
): BrowserSessionHandle | undefined {
  const id = SESSIONS_BY_SUPPLIER.get(supplierId);
  return id ? SESSIONS.get(id) : undefined;
}

export function listSessions(): BrowserSessionHandle[] {
  return Array.from(SESSIONS.values());
}

/** SSE feed: subscribe to a supplier's running session events. */
export function subscribeToSupplier(
  supplierId: string,
  onEvent: (handle: BrowserSessionHandle) => void,
): () => void {
  const channel = `supplier:${supplierId}`;
  BUS.on(channel, onEvent);
  dlog(`[sse] subscribe channel=${channel} listeners=${BUS.listenerCount(channel)}`);
  // Replay current state on subscribe so a late client catches up.
  const current = getSessionBySupplier(supplierId);
  if (current) onEvent(current);
  return () => {
    BUS.off(channel, onEvent);
  };
}

/**
 * Subscribe to JPEG screenshot frames for a supplier session. The callback
 * fires roughly every 250ms with the latest captured frame. On subscribe we
 * replay the most recent frame (if any) so a late client gets an image
 * instantly instead of waiting for the next tick.
 */
export function subscribeToFrames(
  supplierId: string,
  onFrame: (frame: FrameEvent) => void,
): () => void {
  const channel = `frame:${supplierId}`;
  BUS.on(channel, onFrame);
  dlog(
    `[sse] subscribe channel=${channel} listeners=${BUS.listenerCount(channel)} hasLast=${LAST_FRAME.has(supplierId)}`,
  );
  const last = LAST_FRAME.get(supplierId);
  if (last) onFrame(last);
  return () => {
    BUS.off(channel, onFrame);
  };
}

function emit(handle: BrowserSessionHandle): void {
  BUS.emit(`supplier:${handle.supplier_id}`, handle);
  BUS.emit(`session:${handle.session_id}`, handle);
}

function emitFrame(frame: FrameEvent): void {
  LAST_FRAME.set(frame.supplier_id, frame);
  const channel = `frame:${frame.supplier_id}`;
  const subs = BUS.listenerCount(channel);
  dlog(
    `emit frame channel=${channel} subscribers=${subs} bytes=${frame.b64.length}`,
  );
  BUS.emit(channel, frame);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pushLog(
  handle: BrowserSessionHandle,
  kind: ActionEvent["kind"],
  text: string,
): void {
  handle.action_log.push({ t: nowIso(), kind, text });
  // Clip log length so the UI list doesn't grow forever.
  if (handle.action_log.length > 200) {
    handle.action_log.splice(0, handle.action_log.length - 200);
  }
  emit(handle);
}

function setStatus(
  handle: BrowserSessionHandle,
  status: BrowserSessionStatus,
  extra: Partial<BrowserSessionHandle> = {},
): void {
  Object.assign(handle, extra, { status });
  if (
    status === "complete" ||
    status === "partial" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "timeout"
  ) {
    handle.completed_at = nowIso();
  }
  emit(handle);
}

// ───────────────────────────────────────────────────────────────────────────
// Viewport — what the audience sees inside the SessionPanel <img>. We render
// at 16:9 / 1280×720. JPEG quality 50 keeps each frame ~30-80KB; at 4 fps
// that's ~150-300KB/s per session × 3 sessions = manageable on local dev.
// ───────────────────────────────────────────────────────────────────────────

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const FRAME_INTERVAL_MS = 250; // ~4 fps
const FRAME_JPEG_QUALITY = 50;

/**
 * Spawn a screenshot loop that emits a `frame` event ~every 250ms while the
 * page is alive. Returns a stopper. Errors (navigation in flight, page
 * closed) are swallowed silently — the next tick will retry.
 */
function startFrameLoop(supplierId: string, page: Page): () => void {
  let stopped = false;
  let inFlight = false;
  let frameCount = 0;

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
      frameCount += 1;
      if (frameCount <= 3 || frameCount % 20 === 0) {
        dlog(
          `frame loop tick supplier=${supplierId} bytes=${buf.length} n=${frameCount}`,
        );
      }
      emitFrame({
        supplier_id: supplierId,
        ts: nowIso(),
        b64: buf.toString("base64"),
      });
    } catch (err) {
      // mid-navigation / target closed / context destroyed — try again next tick
      if (frameCount === 0) {
        dlog(`frame loop tick error supplier=${supplierId} err=${String(err).slice(0, 80)}`);
      }
    } finally {
      inFlight = false;
    }
  };

  // Fire the first frame immediately rather than waiting 250ms — the gap
  // between session-start and first-visible-frame is what the audience sees
  // as "booting".
  void tick();

  const handle = setInterval(() => {
    void tick();
  }, FRAME_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Real supplier URLs (defaults — override via startSession.target_url).
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_URL: Record<string, string> = {
  refmed: "https://www.referencemedicine.com/",
  geneticist: "https://www.geneticistinc.com/",
  audubon: "https://audubonbio.com/",
};

// ───────────────────────────────────────────────────────────────────────────
// Interaction helpers — every entry in the action log is paired with a real
// Playwright operation. The frame loop runs continuously, so the JPEG stream
// naturally captures motion between actions. Pacing afterwards lets the
// screenshot loop emit 2-3 frames per beat.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Smooth scroll the viewport to absolute Y, then pace so the frame loop
 * captures the motion across multiple ticks.
 */
async function realScroll(page: Page, y: number, pauseMs = 600): Promise<void> {
  try {
    await page.evaluate((targetY) => {
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }, y);
    await page.waitForTimeout(pauseMs);
  } catch {
    // page closed / navigated — caller will catch on next op
  }
}

/**
 * Outline an element in yellow + scroll it into view so the audience sees
 * "the agent is looking at this element". Auto-clears after 1.5s.
 * Returns true if the element existed.
 */
async function highlightElement(
  page: Page,
  selector: string,
  holdMs = 900,
): Promise<boolean> {
  try {
    const found = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return false;
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = "3px solid #ffb800";
      el.style.outlineOffset = "4px";
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.outlineOffset = prevOffset;
      }, 1500);
      return true;
    }, selector);
    if (found) await page.waitForTimeout(holdMs);
    return Boolean(found);
  } catch {
    return false;
  }
}

/**
 * Navigate to a sub-URL with full logging. If the goto fails (404 / network),
 * stay on the current page and signal the caller to fall back to scroll-based
 * extraction. Returns true on a real navigation, false on miss.
 */
async function tryNavigateTo(
  page: Page,
  handle: BrowserSessionHandle,
  url: string,
  label: string,
): Promise<boolean> {
  try {
    pushLog(handle, "navigate", `→ ${label} (${url})`);
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    });
    if (!resp || (resp.status() >= 400 && resp.status() < 600)) {
      pushLog(
        handle,
        "fallback",
        `${label} returned ${resp?.status() ?? "no response"} — falling back to scroll on current page`,
      );
      return false;
    }
    await page.waitForTimeout(700); // first frames of new page
    return true;
  } catch (err) {
    pushLog(
      handle,
      "fallback",
      `${label} navigation failed (${err instanceof Error ? err.message : String(err)}) — staying on current page`,
    );
    return false;
  }
}

/**
 * Click the first link matching any of the selectors and follow the
 * navigation. Returns true if a navigation occurred.
 */
async function tryClickFirstLink(
  page: Page,
  handle: BrowserSessionHandle,
  selectors: string[],
  label: string,
): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      const count = await locator.count();
      if (count === 0) continue;
      const href = await locator.getAttribute("href").catch(() => null);
      pushLog(handle, "navigate", `Clicking ${label} (${sel})`);
      await highlightElement(page, sel, 600);
      const navPromise = page
        .waitForLoadState("domcontentloaded", { timeout: 10_000 })
        .catch(() => {});
      await locator.click({ timeout: 3_000 }).catch(() => {});
      await navPromise;
      await page.waitForTimeout(700);
      if (href) {
        pushLog(handle, "info", `Landed on ${page.url()}`);
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-supplier scrape scripts
// ───────────────────────────────────────────────────────────────────────────

/**
 * Best-effort selector probes. Each probe is wrapped in try/catch so a
 * single selector miss never aborts the scrape — we mark the session
 * `partial` instead and keep going.
 */
async function tryText(page: Page, selector: string, timeoutMs = 2000): Promise<string | null> {
  try {
    const el = await page.waitForSelector(selector, { timeout: timeoutMs });
    const txt = await el.textContent();
    return txt ? txt.trim() : null;
  } catch {
    return null;
  }
}

async function tryAttr(
  page: Page,
  selector: string,
  attr: string,
  timeoutMs = 2000,
): Promise<string | null> {
  try {
    const el = await page.waitForSelector(selector, { timeout: timeoutMs });
    const v = await el.getAttribute(attr);
    return v;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Pacing — the audience needs to SEE the agent work. Each extract event gets
// a randomized 400-700ms pause so the action log unspools over 15-25 seconds
// instead of bursting all at once after page load. Interleaved narrative
// blurbs ("Scrolling to contact section…") sell the impression that the
// agent is reasoning, not just regexp-matching.
//
// Random (not fixed) jitter — feels less scripted.
// ───────────────────────────────────────────────────────────────────────────

function jitter(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function pace(handle: BrowserSessionHandle, min = 400, max = 700): Promise<void> {
  // Bail early if we've already been timed out — keeps cleanup snappy.
  if (
    handle.status === "timed_out" ||
    handle.status === "timeout" ||
    handle.status === "failed"
  ) {
    return;
  }
  await new Promise((r) => setTimeout(r, jitter(min, max)));
}

/**
 * Short narrative blurb to make the agent feel like it's thinking.
 * Retained as an export-style helper; new scrapes inline `pushLog` + `pace`
 * adjacent to a real Playwright action so the log stays in sync with motion.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function think(
  handle: BrowserSessionHandle,
  text: string,
  min = 350,
  max = 650,
): Promise<void> {
  pushLog(handle, "info", text);
  await pace(handle, min, max);
}

function extractEmails(text: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return Array.from(new Set(text.match(re) ?? []));
}

function extractPhones(text: string): string[] {
  // Loose US-style; we're after one good number for the BD contact field.
  const re = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
  return Array.from(new Set(text.match(re) ?? []));
}

function refmedXlsxPath(): string {
  return (
    process.env.REFMED_XLSX_PATH ??
    path.join(
      process.cwd(),
      "docs",
      "yc-hackathon ", // trailing space — matches filesystem
      "Reference Medicine_May Inverntory File.xlsx",
    )
  );
}

async function scrapeRefmed(page: Page, handle: BrowserSessionHandle): Promise<void> {
  const origin = new URL(handle.target_url).origin;

  // ─── STEP 1: homepage scan ──────────────────────────────────────────────
  pushLog(handle, "wait", "Reading homepage…");
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await pace(handle, 500, 900);

  pushLog(handle, "info", "Scrolling through hero / marketing copy…");
  await realScroll(page, 400, 600);
  await realScroll(page, 900, 600);

  const homeText = (await page.textContent("body").catch(() => "")) ?? "";

  pushLog(handle, "info", "Parsing marketing copy for oncology indications…");
  const claimed: string[] = [];
  for (const tag of ["NSCLC", "lung", "breast", "colorectal", "CRC", "prostate", "pancreatic", "oncology"]) {
    if (new RegExp(`\\b${tag}\\b`, "i").test(homeText)) claimed.push(tag);
  }
  if (claimed.length > 0) {
    handle.extracted.claimed_conditions = claimed;
    pushLog(handle, "extract", `claimed_conditions = [${claimed.join(", ")}]`);
    await pace(handle);
  }

  handle.extracted.geography = "USA";
  pushLog(handle, "extract", "geography = USA");
  await pace(handle);

  // ─── STEP 2: inventory / catalog sub-page ───────────────────────────────
  pushLog(handle, "info", "Looking for catalog or inventory link…");
  // Try clicking the visible link first (better screenshot of the click motion).
  const inventorySelectors = [
    'a[href*="inventory"]',
    'a[href*="catalog"]',
    'a[href*="biospecimen"]',
    'a[href*="samples"]',
  ];
  const inventoryClicked = await tryClickFirstLink(
    page,
    handle,
    inventorySelectors,
    "inventory link",
  );

  let inventoryReached = inventoryClicked;
  if (!inventoryClicked) {
    // Selector miss — try direct URL paths.
    for (const candidate of ["/inventory", "/catalog", "/biospecimens"]) {
      const ok = await tryNavigateTo(page, handle, origin + candidate, "inventory page");
      if (ok) {
        inventoryReached = true;
        break;
      }
    }
  }

  if (inventoryReached) {
    pushLog(handle, "info", "Scrolling the inventory page…");
    await realScroll(page, 300, 500);
    await realScroll(page, 800, 500);
    const invText = (await page.textContent("body").catch(() => "")) ?? "";

    for (const tag of ["FFPE", "plasma", "serum", "frozen", "buffy coat", "whole blood"]) {
      if (new RegExp(`\\b${tag}\\b`, "i").test(invText)) {
        handle.extracted.sample_types = (handle.extracted.sample_types ?? []).concat(tag);
      }
    }
    if (handle.extracted.sample_types && handle.extracted.sample_types.length > 0) {
      pushLog(
        handle,
        "extract",
        `sample_types = [${handle.extracted.sample_types.join(", ")}]`,
      );
      await pace(handle);
    }

    // Capture public catalog URL — the current page IS the catalog.
    handle.extracted.public_catalog_url = page.url();
    pushLog(handle, "extract", `public_catalog_url = ${page.url()}`);
    await pace(handle);
  } else {
    pushLog(handle, "fallback", "No inventory sub-page — scrolling homepage further for sample-type tags…");
    await realScroll(page, 1400, 500);
    await realScroll(page, 1900, 500);
    const moreText = (await page.textContent("body").catch(() => "")) ?? "";
    for (const tag of ["FFPE", "plasma", "serum", "frozen", "buffy coat", "whole blood"]) {
      if (new RegExp(`\\b${tag}\\b`, "i").test(moreText)) {
        handle.extracted.sample_types = (handle.extracted.sample_types ?? []).concat(tag);
      }
    }
    if (handle.extracted.sample_types && handle.extracted.sample_types.length > 0) {
      pushLog(
        handle,
        "extract",
        `sample_types = [${handle.extracted.sample_types.join(", ")}]`,
      );
      await pace(handle);
    }
  }

  // ─── STEP 3: contact page ──────────────────────────────────────────────
  pushLog(handle, "info", "Navigating to contact page for BD outreach details…");
  const contactClicked = await tryClickFirstLink(
    page,
    handle,
    ['a[href*="contact"]', 'a[href*="Contact"]', 'footer a[href*="mailto"]'],
    "contact link",
  );

  let contactReached = contactClicked;
  if (!contactClicked) {
    for (const candidate of ["/contact", "/contact-us", "/about/contact"]) {
      const ok = await tryNavigateTo(page, handle, origin + candidate, "contact page");
      if (ok) {
        contactReached = true;
        break;
      }
    }
  }

  if (contactReached) {
    pushLog(handle, "info", "Scrolling to find email + phone…");
    await realScroll(page, 200, 500);
    await realScroll(page, 600, 500);

    // Highlight an email link if one is visible.
    const hasMailto = await highlightElement(page, 'a[href^="mailto:"]', 700);
    const contactText = (await page.textContent("body").catch(() => "")) ?? "";
    const mailtoHref = hasMailto
      ? await page.locator('a[href^="mailto:"]').first().getAttribute("href").catch(() => null)
      : null;
    const email = mailtoHref?.replace("mailto:", "").split("?")[0] ?? extractEmails(contactText)[0];
    if (email) {
      handle.extracted.contact_email = email;
      pushLog(handle, "extract", `contact_email = ${email}`);
      await pace(handle);
    }
    const phones = extractPhones(contactText);
    if (phones[0]) {
      handle.extracted.contact_phone = phones[0];
      pushLog(handle, "extract", `contact_phone = ${phones[0]}`);
      await pace(handle);
    }
  } else {
    pushLog(handle, "fallback", "No dedicated contact page — scraping footer of current page…");
    await realScroll(page, 99999, 700); // scroll to bottom
    const footerText = (await page.textContent("body").catch(() => "")) ?? "";
    const email = extractEmails(footerText)[0];
    if (email) {
      handle.extracted.contact_email = email;
      pushLog(handle, "extract", `contact_email = ${email}`);
      await pace(handle);
    }
    const phone = extractPhones(footerText)[0];
    if (phone) {
      handle.extracted.contact_phone = phone;
      pushLog(handle, "extract", `contact_phone = ${phone}`);
      await pace(handle);
    }
  }

  // ─── STEP 4: XLSX reveal beat ───────────────────────────────────────────
  // The file is already in memory (loaded at server boot) — we just narrate
  // the discovery so the audience SEES the scrape "find" the catalog. Try
  // to click an XLSX link if one exists, otherwise stay on current page.
  pushLog(handle, "info", "Found XLSX inventory link — downloading…");
  const xlsxLocator = page.locator('a[href$=".xlsx"]').first();
  const xlsxCount = await xlsxLocator.count().catch(() => 0);
  if (xlsxCount > 0) {
    await highlightElement(page, 'a[href$=".xlsx"]', 900);
    await page.waitForTimeout(700);
  } else {
    await page.waitForTimeout(1200);
  }
  try {
    const { cases, specimens } = loadRefMed(refmedXlsxPath());
    const counts = new Map<string, number>();
    for (const c of cases) {
      const k = c.primary_tumor_site || c.tumor_type || "unknown";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const top_indications = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, n]) => `${k} (${n})`);
    handle.extracted.inventory_loaded = {
      case_count: cases.length,
      specimen_count: specimens.length,
      top_indications,
    };
    pushLog(
      handle,
      "extract",
      `Parsed ${specimens.length.toLocaleString()} rows / ${counts.size} conditions ✓`,
    );
    emit(handle);
    await pace(handle);
  } catch (err) {
    pushLog(
      handle,
      "fallback",
      `XLSX parse skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function scrapeGeneticist(page: Page, handle: BrowserSessionHandle): Promise<void> {
  const origin = new URL(handle.target_url).origin;

  // ─── STEP 1: homepage ───────────────────────────────────────────────────
  pushLog(handle, "wait", "Reading homepage…");
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await pace(handle, 500, 900);

  pushLog(handle, "info", "Scrolling through hero copy…");
  await realScroll(page, 400, 600);
  await realScroll(page, 900, 600);

  const homeText = (await page.textContent("body").catch(() => "")) ?? "";

  pushLog(handle, "info", "Parsing copy for indication signals…");
  const claimed: string[] = [];
  for (const tag of ["NSCLC", "lung", "CRC", "colon", "breast", "oncology", "tumor", "cancer"]) {
    if (new RegExp(`\\b${tag}\\b`, "i").test(homeText)) claimed.push(tag);
  }
  if (claimed.length > 0) {
    handle.extracted.claimed_conditions = claimed;
    pushLog(handle, "extract", `claimed_conditions = [${claimed.join(", ")}]`);
    await pace(handle);
  }

  handle.extracted.geography = "USA";
  pushLog(handle, "extract", "geography = USA");
  await pace(handle);

  // ─── STEP 2: About / team page ─────────────────────────────────────────
  pushLog(handle, "info", "Navigating to About / team page…");
  const aboutClicked = await tryClickFirstLink(
    page,
    handle,
    [
      'a[href*="about"]',
      'a[href*="About"]',
      'a[href*="team"]',
      'a[href*="leadership"]',
    ],
    "about link",
  );

  let aboutReached = aboutClicked;
  if (!aboutClicked) {
    for (const candidate of ["/about", "/about-us", "/team"]) {
      const ok = await tryNavigateTo(page, handle, origin + candidate, "about page");
      if (ok) {
        aboutReached = true;
        break;
      }
    }
  }

  if (aboutReached) {
    pushLog(handle, "info", "Scrolling the team / About page for BD signals…");
    await realScroll(page, 300, 500);
    await realScroll(page, 800, 500);
    const aboutText = (await page.textContent("body").catch(() => "")) ?? "";

    const nameMatch = aboutText.match(
      /(?:Founder|CEO|President|BD|Business Development|Director|Manager)[^\n]{0,60}?([A-Z][a-z]+\s+[A-Z][a-z]+)/,
    );
    if (nameMatch?.[1]) {
      handle.extracted.contact_bd_name = nameMatch[1];
      pushLog(handle, "extract", `contact_bd_name = ${nameMatch[1]}`);
      await pace(handle);
    }
  } else {
    pushLog(handle, "fallback", "About page unreachable — scrolling homepage for bio signals…");
    await realScroll(page, 1500, 500);
    await realScroll(page, 2200, 500);
  }

  // ─── STEP 3: Contact page ──────────────────────────────────────────────
  pushLog(handle, "info", "Navigating to contact page for email + phone…");
  const contactClicked = await tryClickFirstLink(
    page,
    handle,
    ['a[href*="contact"]', 'a[href*="Contact"]', 'footer a[href*="mailto"]'],
    "contact link",
  );

  let contactReached = contactClicked;
  if (!contactClicked) {
    for (const candidate of ["/contact", "/contact-us"]) {
      const ok = await tryNavigateTo(page, handle, origin + candidate, "contact page");
      if (ok) {
        contactReached = true;
        break;
      }
    }
  }

  if (contactReached) {
    pushLog(handle, "info", "Scrolling to contact block…");
    await realScroll(page, 300, 500);
    await realScroll(page, 700, 500);
    const hasMailto = await highlightElement(page, 'a[href^="mailto:"]', 800);
    const contactText = (await page.textContent("body").catch(() => "")) ?? "";
    const mailtoHref = hasMailto
      ? await page.locator('a[href^="mailto:"]').first().getAttribute("href").catch(() => null)
      : null;
    const email = mailtoHref?.replace("mailto:", "").split("?")[0] ?? extractEmails(contactText)[0];
    if (email) {
      handle.extracted.contact_email = email;
      pushLog(handle, "extract", `contact_email = ${email}`);
      await pace(handle);
    }
    const phone = extractPhones(contactText)[0];
    if (phone) {
      handle.extracted.contact_phone = phone;
      pushLog(handle, "extract", `contact_phone = ${phone}`);
      await pace(handle);
    }
  } else {
    pushLog(handle, "fallback", "No dedicated contact page — scrolling current page footer…");
    await realScroll(page, 99999, 700);
    const footerText = (await page.textContent("body").catch(() => "")) ?? "";
    const email = extractEmails(footerText)[0];
    if (email) {
      handle.extracted.contact_email = email;
      pushLog(handle, "extract", `contact_email = ${email}`);
      await pace(handle);
    }
    const phone = extractPhones(footerText)[0];
    if (phone) {
      handle.extracted.contact_phone = phone;
      pushLog(handle, "extract", `contact_phone = ${phone}`);
      await pace(handle);
    }
  }
}

async function scrapeAudubon(page: Page, handle: BrowserSessionHandle): Promise<void> {
  const origin = new URL(handle.target_url).origin;

  // ─── STEP 1: homepage / services scan ───────────────────────────────────
  pushLog(handle, "wait", "Reading homepage…");
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await pace(handle, 500, 900);

  pushLog(handle, "info", "Scrolling through services section…");
  await realScroll(page, 500, 600);
  await realScroll(page, 1100, 600);

  const homeText = (await page.textContent("body").catch(() => "")) ?? "";

  pushLog(handle, "info", "Parsing marketing copy for indications…");
  const claimed: string[] = [];
  for (const tag of ["NSCLC", "lung", "tumor", "cancer", "oncology"]) {
    if (new RegExp(`\\b${tag}\\b`, "i").test(homeText)) claimed.push(tag);
  }
  if (claimed.length > 0) {
    handle.extracted.claimed_conditions = claimed;
    pushLog(handle, "extract", `claimed_conditions = [${claimed.join(", ")}]`);
    await pace(handle);
  }

  handle.extracted.geography = "USA";
  pushLog(handle, "extract", "geography = USA");
  await pace(handle);

  // ─── STEP 2: quote / intake form page ──────────────────────────────────
  pushLog(handle, "info", "Looking for the quote / intake form…");
  const formClicked = await tryClickFirstLink(
    page,
    handle,
    [
      'a[href*="quote"]',
      'a[href*="request"]',
      'a[href*="intake"]',
      'a[href*="form"]',
    ],
    "quote/intake link",
  );

  let formReached = formClicked;
  if (!formClicked) {
    for (const candidate of ["/quote-request", "/request-a-quote", "/contact"]) {
      const ok = await tryNavigateTo(page, handle, origin + candidate, "intake form page");
      if (ok) {
        formReached = true;
        break;
      }
    }
  }

  if (formReached) {
    handle.extracted.intake_form_url = page.url();
    pushLog(handle, "extract", `intake_form_url = ${page.url()}`);
    await pace(handle);

    pushLog(handle, "info", "Scrolling the form fields…");
    await realScroll(page, 400, 500);
    await realScroll(page, 900, 500);
    // Highlight a couple of form inputs so the audience SEES the agent inspect the form.
    await highlightElement(page, "form input, form textarea", 800);

    const formText = (await page.textContent("body").catch(() => "")) ?? "";
    const email = extractEmails(formText)[0];
    if (email) {
      handle.extracted.contact_email = email;
      pushLog(handle, "extract", `contact_email = ${email}`);
      await pace(handle);
    }
    const phone = extractPhones(formText)[0];
    if (phone) {
      handle.extracted.contact_phone = phone;
      pushLog(handle, "extract", `contact_phone = ${phone}`);
      await pace(handle);
    }
  } else {
    pushLog(handle, "fallback", "No quote form found — scrolling footer for contact details…");
    await realScroll(page, 99999, 700);
    const footerText = (await page.textContent("body").catch(() => "")) ?? "";
    const email = extractEmails(footerText)[0];
    if (email) {
      handle.extracted.contact_email = email;
      pushLog(handle, "extract", `contact_email = ${email}`);
      await pace(handle);
    }
    const phone = extractPhones(footerText)[0];
    if (phone) {
      handle.extracted.contact_phone = phone;
      pushLog(handle, "extract", `contact_phone = ${phone}`);
      await pace(handle);
    }
    handle.extracted.intake_form_url = handle.target_url;
    pushLog(handle, "extract", `intake_form_url = ${handle.target_url}`);
    await pace(handle);
  }

  // ─── STEP 3: About / services page for richer claims ────────────────────
  pushLog(handle, "info", "Visiting About / Services page for richer claim signals…");
  const aboutClicked = await tryClickFirstLink(
    page,
    handle,
    ['a[href*="about"]', 'a[href*="services"]', 'a[href*="capabilit"]'],
    "about/services link",
  );

  let aboutReached = aboutClicked;
  if (!aboutClicked) {
    for (const candidate of ["/about", "/services", "/about-us"]) {
      const ok = await tryNavigateTo(page, handle, origin + candidate, "about/services page");
      if (ok) {
        aboutReached = true;
        break;
      }
    }
  }

  if (aboutReached) {
    pushLog(handle, "info", "Scrolling about/services copy…");
    await realScroll(page, 400, 500);
    await realScroll(page, 900, 500);
    const aboutText = (await page.textContent("body").catch(() => "")) ?? "";
    const moreClaims: string[] = [];
    for (const tag of ["NSCLC", "lung", "tumor", "cancer", "oncology", "rare disease", "biomarker"]) {
      if (
        new RegExp(`\\b${tag}\\b`, "i").test(aboutText) &&
        !(handle.extracted.claimed_conditions ?? []).includes(tag)
      ) {
        moreClaims.push(tag);
      }
    }
    if (moreClaims.length > 0) {
      handle.extracted.claimed_conditions = [
        ...(handle.extracted.claimed_conditions ?? []),
        ...moreClaims,
      ];
      pushLog(
        handle,
        "extract",
        `claimed_conditions += [${moreClaims.join(", ")}]`,
      );
      await pace(handle);
    }
  } else {
    pushLog(handle, "fallback", "About / Services page unreachable — keeping homepage signals only.");
  }
}

async function runScrape(
  supplierId: string,
  page: Page,
  handle: BrowserSessionHandle,
): Promise<void> {
  switch (supplierId) {
    case "refmed":
      return scrapeRefmed(page, handle);
    case "geneticist":
      return scrapeGeneticist(page, handle);
    case "audubon":
      return scrapeAudubon(page, handle);
    default:
      // Generic best-effort fallback: pull emails + geography.
      pushLog(handle, "wait", "Generic scrape (no custom script)…");
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
      const emails = extractEmails(bodyText);
      if (emails[0]) {
        handle.extracted.contact_email = emails[0];
        pushLog(handle, "extract", `contact_email = ${emails[0]}`);
      }
      return;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// startSession — main entry. Launches a headed Chromium window, navigates,
// runs the scrape script, emits events. Hard 45s timeout.
// ───────────────────────────────────────────────────────────────────────────

export async function startSession(
  input: StartSessionInput,
): Promise<BrowserSessionHandle> {
  const target_url =
    input.target_url ?? DEFAULT_URL[input.supplier_id] ?? "about:blank";
  const session_id = newId(`sess_${input.supplier_id}`);
  const started_at = nowIso();

  const handle: BrowserSessionHandle = {
    session_id,
    task_id: null,
    live_view_url: null,
    supplier_id: input.supplier_id,
    target_url,
    status: "starting",
    started_at,
    action_log: [],
    extracted: {},
    mode: "local",
  };
  SESSIONS.set(session_id, handle);
  SESSIONS_BY_SUPPLIER.set(input.supplier_id, session_id);
  emit(handle);

  // Kill any prior frame loop for this supplier (back-to-back enrich runs,
  // hot reload, etc). Without this, every fresh run stacks another setInterval
  // and the frame stream emits indefinitely — Audubon leak symptom (n=160+
  // ticks post-completion).
  const priorStop = FRAME_STOPPERS.get(input.supplier_id);
  if (priorStop) {
    dlog(`stopping prior frame loop for supplier=${input.supplier_id}`);
    try {
      priorStop();
    } catch {
      // ignore
    }
    FRAME_STOPPERS.delete(input.supplier_id);
  }

  dlog(`startSession supplier=${input.supplier_id} target_url=${target_url}`);
  pushLog(handle, "info", `Launching local Chromium for ${input.supplier_id}`);

  // Launch on a separate microtask so the caller (Promise.allSettled) gets
  // the handle synchronously and all sessions stream concurrently.
  void (async () => {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let stopFrames: (() => void) | null = null;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      pushLog(handle, "error", `Hard timeout after ${SESSION_HARD_TIMEOUT_MS / 1000}s`);
      setStatus(handle, "timed_out", {
        error: `hard timeout after ${SESSION_HARD_TIMEOUT_MS}ms`,
      });
    }, SESSION_HARD_TIMEOUT_MS);

    try {
      const tLaunch0 = Date.now();
      dlog(`chromium.launch() begin supplier=${input.supplier_id}`);
      browser = await chromium.launch({ headless: true });
      dlog(
        `chromium.launch() done supplier=${input.supplier_id} +${Date.now() - tLaunch0}ms`,
      );
      context = await browser.newContext({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120 Safari/537.36 crovi-demo/1.0",
      });
      page = await context.newPage();
      PAGES.set(session_id, { browser, context, page });

      setStatus(handle, "live");
      pushLog(handle, "navigate", `→ ${target_url}`);

      // Begin screenshot stream BEFORE goto so a frame lands the instant the
      // page has anything on it (about:blank → first paint of target site).
      // The loop is silent on errors so mid-navigation flakes are absorbed.
      stopFrames = startFrameLoop(input.supplier_id, page);
      FRAME_STOPPERS.set(input.supplier_id, stopFrames);

      const tNav0 = Date.now();
      dlog(`page.goto() begin url=${target_url}`);
      await page.goto(target_url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      dlog(`page.goto() done url=${target_url} +${Date.now() - tNav0}ms`);

      // Force a screenshot immediately after navigation lands so first-frame
      // arrives at the SSE consumer in well under FRAME_INTERVAL_MS.
      try {
        const buf = await page.screenshot({
          type: "jpeg",
          quality: FRAME_JPEG_QUALITY,
          fullPage: false,
        });
        emitFrame({
          supplier_id: input.supplier_id,
          ts: nowIso(),
          b64: buf.toString("base64"),
        });
      } catch {
        // first-shot may race with the in-loop tick; the next interval will catch up.
      }

      if (timedOut) return;
      setStatus(handle, "running");
      await runScrape(input.supplier_id, page, handle);

      if (timedOut) return;

      // Decide complete vs partial based on how many extracted fields landed.
      const fieldsFound = Object.values(handle.extracted).filter(
        (v) => v != null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0),
      ).length;
      if (fieldsFound >= 3) {
        setStatus(handle, "complete", {
          output: `Extracted ${fieldsFound} fields from ${target_url}`,
        });
        pushLog(handle, "info", `✓ Scrape complete (${fieldsFound} fields)`);
      } else {
        setStatus(handle, "partial", {
          output: `Extracted ${fieldsFound} fields (partial) from ${target_url}`,
        });
        pushLog(
          handle,
          "fallback",
          `Partial: only ${fieldsFound} fields landed — kept URL as fallback evidence`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushLog(handle, "error", `Scrape error: ${message}`);
      // Don't crash — mark partial so the demo keeps moving.
      setStatus(handle, "partial", {
        output: `Soft fail at ${target_url}`,
        error: message,
        extracted: {
          ...handle.extracted,
          notes: `fallback: visited ${target_url} but extraction failed (${message})`,
        },
      });
    } finally {
      clearTimeout(timeout);
      // Stop the frame loop IMMEDIATELY on terminal state. The SSE replay
      // (LAST_FRAME) keeps the final screenshot visible on reconnect; we don't
      // need the interval to keep ticking. Closing the browser is deferred a
      // few seconds to allow any in-flight screenshot to finish cleanly.
      try {
        stopFrames?.();
      } catch {
        // ignore
      }
      if (FRAME_STOPPERS.get(input.supplier_id) === stopFrames) {
        FRAME_STOPPERS.delete(input.supplier_id);
      }
      setTimeout(async () => {
        try {
          await page?.close();
          await context?.close();
          await browser?.close();
        } catch {
          // ignore
        }
        PAGES.delete(session_id);
      }, 3_000);
    }
  })();

  return handle;
}

/**
 * Called by tests / dry-runs to flip a handle to complete without driving
 * Playwright. Kept for shape parity with the cloud webhook surface.
 */
export function markSessionComplete(
  sessionId: string,
  output: string | undefined,
): BrowserSessionHandle | undefined {
  const current = SESSIONS.get(sessionId);
  if (!current) return undefined;
  setStatus(current, "complete", { output });
  return current;
}

// ───────────────────────────────────────────────────────────────────────────
// Form-fill surface (Stage 1) — kept as a stub when run outside the demo
// chain. The headed Chromium driver above is the V1 enrichment path; the
// Stage 1 form-fill agent lives behind submitForm() and can be wired to
// Playwright in V4 if needed. For now we keep the existing stub behavior
// so lib/agents/fill.ts compiles unchanged.
// ───────────────────────────────────────────────────────────────────────────

export interface FormSubmitResult {
  submission_id: string;
  confirmation_message?: string;
  redirect_url?: string;
  submitted_at: string;
  envelope: {
    target_url: string;
    fields: Record<string, string>;
  };
  mode: "local" | "stub";
}

export interface SubmitFormInput {
  runId: string;
  runDir: string;
  supplier: BiobankOpportunity;
  fields: Record<string, string>;
}

export async function submitForm(input: SubmitFormInput): Promise<FormSubmitResult> {
  const { runDir, supplier, fields } = input;
  const targetUrl = supplier.contact.quote_form_url ?? supplier.contact.site_url;
  const submitted_at = new Date().toISOString();

  resolveDestination("form", targetUrl);

  // Stub-only path: write the envelope to disk for the audit log and
  // return a deterministic submission id. Local headed form fill belongs
  // to the Stage 1 chain implementation (V4) — not in scope for the
  // enrichment swap.
  const outboxDir = path.join(runDir, "outbox", "form");
  fs.mkdirSync(outboxDir, { recursive: true });
  const stub_id = `local_form_${Date.now()}`;
  const record: FormSubmitResult = {
    submission_id: stub_id,
    confirmation_message: `Local stub: ${Object.keys(fields).length} fields prepared for ${targetUrl}.`,
    submitted_at,
    envelope: { target_url: targetUrl, fields },
    mode: "stub",
  };
  fs.writeFileSync(
    path.join(outboxDir, `${submitted_at.replace(/[:.]/g, "-")}_${supplier.id}.json`),
    JSON.stringify({ ...record, demo_mode: demoModeActive() }, null, 2),
  );
  return record;
}
