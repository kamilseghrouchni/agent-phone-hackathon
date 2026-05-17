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
  console.log(`  📸 ${name}.png (${(fs.statSync(p).size/1024)|0}KB)`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", e => errors.push(`PageError: ${e.message}`));
page.on("console", m => { if (m.type() === "error") errors.push(`Console: ${m.text().slice(0, 120)}`); });

console.log("STEP 1: home");
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await shot(page, "01-home");

console.log("STEP 2: drop PDF");
const [fileChooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.click('[role="button"]:has-text("Drop"), button:has-text("Drop"), .dz, [class*="dz "]').catch(async () => {
    // fallback: click anywhere on the dropzone area
    await page.click(".dz, [class*='dz-']");
  })
]);
await fileChooser.setFiles(PDF);
await page.waitForURL(/\/workspace\?runId=/, { timeout: 12000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
await shot(page, "02-confirm");

console.log("STEP 3: scroll confirm to bottom + screenshot full intake");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
await shot(page, "03-confirm-bottom");

console.log("STEP 4: scroll back, click Launch enrichment");
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const launchBtn = await page.locator('button:has-text("Launch enrichment"), button:has-text("Launch")').first();
console.log(`  launch button: ${await launchBtn.count() ? 'found' : 'NOT FOUND'}`);
await launchBtn.click({ timeout: 8000 });
await page.waitForTimeout(3000); // give the enrich phase time to mount + send /api/enrich/start
await shot(page, "04-enrich-t0");

console.log("STEP 5: wait 8s for Chromium sessions to start streaming");
await page.waitForTimeout(8000);
await shot(page, "05-enrich-t8");

console.log("STEP 6: wait another 10s for scrapes to progress");
await page.waitForTimeout(10000);
await shot(page, "06-enrich-t18");

console.log("STEP 7: click Geneticist card pip ▣ to switch right pane");
const geneticistPip = page.locator('button[aria-label*="Geneticist"], button:near(:text("Geneticist Inc")):has-text("▣")').first();
const found = await geneticistPip.count();
console.log(`  geneticist pip: ${found ? 'found' : 'NOT FOUND, trying broader selector'}`);
if (!found) {
  // Try clicking any ▣ that has Geneticist in nearby text
  const allPips = await page.locator('button:has-text("▣")').all();
  console.log(`  total ▣ pips: ${allPips.length}`);
  if (allPips.length >= 2) await allPips[1].click(); // second pip is geneticist
} else {
  await geneticistPip.click();
}
await page.waitForTimeout(5000);
await shot(page, "07-geneticist-live");

console.log("STEP 8: click Crovi.bio pip");
const allPips = await page.locator('button:has-text("▣")').all();
if (allPips.length >= 4) await allPips[3].click(); // 4th = crovi
await page.waitForTimeout(5000);
await shot(page, "08-crovi-live");

console.log("");
console.log(`Errors captured: ${errors.length}`);
errors.slice(0, 10).forEach(e => console.log(`  ! ${e}`));

await browser.close();
console.log("DONE — see screenshots/drive/");
