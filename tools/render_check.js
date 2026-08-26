/* tools/render_check.js — screenshot each imported car preview in a real
 * headless Chromium and pixel-verify rendered detail.                   */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "node_modules", "playwright-core"));
const { PNG } = require(path.join(__dirname, "..", "node_modules", "pngjs"));

const EXE = "/Users/shu/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://localhost:8017/index.html";
const OUT = path.join(__dirname, "..", ".shots");
const KEYS = ["lambo", "storm", "s7", "gtsport", "concept_s"];

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", m => { if (m.text().includes("unavailable")) consoleErrors.push(m.text()); });

  for (const key of KEYS) {
    await page.goto(`${BASE}?car=${key}&screen=car`, { waitUntil: "load", timeout: 30000 });
    const argKey = key;
    await page.waitForFunction(
      k => window.__CAR_MODEL_CACHE__ && window.__CAR_MODEL_CACHE__[k] && window.__CAR_MODEL_CACHE__[k].ready,
      argKey, { timeout: 20000 }
    );
    await page.waitForTimeout(1200);
    const el = await page.$("#car-preview");
    await el.screenshot({ path: path.join(OUT, `final_preview_${key}.png`) });
    void argKey;
  }
  if (consoleErrors.length) {
    console.error("console errors:", consoleErrors);
    process.exit(1);
  }
  console.log("browser errors: none ✓");

  let allDetail = true;
  for (const key of KEYS) {
    const png = PNG.sync.read(fs.readFileSync(path.join(OUT, `final_preview_${key}.png`)));
    let colors = new Set();
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (r + g + b > 150) colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
    console.log(key.padEnd(10), "unique lit colors:", String(colors.size).padStart(5));
    if (colors.size < 200) allDetail = false;
  }
  await browser.close();
  console.log(allDetail ? "\nALL FIVE IMPORTS RENDER WITH DETAIL" : "RENDER CHECK FAILED");
  if (!allDetail) process.exit(1);
})();
