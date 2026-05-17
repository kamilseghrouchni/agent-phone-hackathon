import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const ROOT = "/Users/kamilseghrouchni/Desktop/side-projects/crovi-mvp-ychack";
const PDF = path.join(ROOT, "docs/yc-hackathon ", "Sample_Completed_Biospecimen_Request.pdf");
const OUT = path.join(ROOT, "screenshots/drive");
fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${name}.png (${(fs.statSync(p).size / 1024) | 0}KB)`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.log("ERR:", e.message));

console.log("1. home");
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await shot(page, "01-home");

console.log("2. setInputFiles directly");
const input = page.locator('input[type="file"]').first();
await input.setInputFiles(PDF);
await page.waitForURL(/\/workspace\?runId=/, { timeout: 15000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2000);
await shot(page, "02-confirm");

console.log("3. confirm-bottom");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
await shot(page, "03-confirm-bottom");

console.log("4. launch enrichment");
await page.evaluate(() => window.scrollTo(0, 0));
const launch = page.locator('button:has-text("Launch enrichment")').first();
console.log("  launch found:", await launch.count());
await launch.click();
await page.waitForTimeout(2500);
await shot(page, "04-enrich-t0");

console.log("5. wait 10s for sessions to stream");
await page.waitForTimeout(10000);
await shot(page, "05-enrich-t10");

console.log("6. wait another 15s");
await page.waitForTimeout(15000);
await shot(page, "06-enrich-t25");

console.log("7. inspect supplier cards");
const cardNames = await page.locator('h3, .enrich-card-name, [class*="supplier-name"]').allTextContents();
console.log("  cards:", cardNames.slice(0, 10));

const allPips = await page.locator('button:has-text("▣")').all();
console.log("  total ▣ pips:", allPips.length);

if (allPips.length >= 2) {
  console.log("8. click pip[1] (geneticist)");
  await allPips[1].click();
  await page.waitForTimeout(4000);
  await shot(page, "07-geneticist-live");
}

if (allPips.length >= 4) {
  console.log("9. click pip[3] (crovi)");
  await allPips[3].click();
  await page.waitForTimeout(4000);
  await shot(page, "08-crovi-live");
}

await browser.close();
console.log("DONE");
