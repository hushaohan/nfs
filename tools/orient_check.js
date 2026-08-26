/* tools/orient_check.js — render STREET GT at three roll angles and
 * pixel-analyze which looks like an upright car                        */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "node_modules", "playwright-core"));
const { PNG } = require(path.join(__dirname, "..", "node_modules", "pngjs"));

const EXE = "/Users/shu/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://localhost:8017/index.html";
const OUT = path.join(__dirname, "..", ".shots");

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  for (const roll of [-90, 0, 90]) {
    await page.goto(`${BASE}?car=streetgt&screen=car&roll=${roll}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(
      () => window.__CAR_MODEL_CACHE__ && window.__CAR_MODEL_CACHE__.streetgt &&
            window.__CAR_MODEL_CACHE__.streetgt.ready,
      null, { timeout: 20000 }
    );
    await page.waitForTimeout(1200);
    const el = await page.$("#car-preview");
    await el.screenshot({ path: path.join(OUT, `orient_${roll}.png`) });
    console.log("shot orient_" + roll);
  }
  await browser.close();

  // analyze: silhouette aspect ratio + vertical center of mass
  const { PNG } = require(path.join(__dirname, "..", "node_modules", "pngjs"));
  for (const roll of [-90, 0, 90]) {
    const png = PNG.sync.read(fs.readFileSync(path.join(OUT, `orient_${roll}.png`)));
    const { width, height, data } = png;
    let minX = width, maxX = 0, minY = height, maxY = 0, sumY = 0, n = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (lum > 45) {   // not near-black backdrop
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          sumY += y; n++;
        }
      }
    }
    const w = maxX - minX, h = maxY - minY;
    const comY = n ? (sumY / n).toFixed(0) : "?";
    console.log(`roll ${String(roll).padStart(4)}: silhouette ${w}×${h} | w/h=${(w / h).toFixed(2)} | vCoM ${comY}/${height}`);
  }
})();
