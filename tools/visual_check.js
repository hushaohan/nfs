/* tools/visual_check.js — real-browser visual verification.
 * Screenshots the car-select preview (and a race frame) per imported
 * model so rendering issues are SEEN, not inferred.                    */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(__dirname, "..", "node_modules", "playwright-core"));

const EXE = "/Users/shu/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://localhost:8017/index.html";
const OUT = path.join(__dirname, "..", ".shots");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  for (const key of ["lambo", "storm", "s7"]) {
    await page.goto(`${BASE}?car=${key}&screen=car`, { waitUntil: "load" });
    // wait until the embedded model has decoded and the preview rebuilt
    await page.waitForFunction(
      k => window.__CAR_MODEL_CACHE__ && window.__CAR_MODEL_CACHE__[k] && window.__CAR_MODEL_CACHE__[k].ready,
      key, { timeout: 20000 }
    );
    await page.waitForTimeout(1200);           // let the turntable settle
    await page.screenshot({ path: path.join(OUT, `preview_${key}.png`) });
    console.log("shot:", `preview_${key}.png`);
  }

  // race frames with an imported car in the player slot
  await page.goto(`${BASE}?car=lambo&autostart=1`, { waitUntil: "load" });
  await page.waitForFunction(
    () => window.__CAR_MODEL_CACHE__ && window.__CAR_MODEL_CACHE__.lambo && window.__CAR_MODEL_CACHE__.lambo.ready,
    null, { timeout: 20000 }
  );
  await page.waitForTimeout(4500);             // countdown + a bit of driving
  await page.screenshot({ path: path.join(OUT, "race_lambo_1.png") });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "race_lambo_2.png") });
  console.log("shot: race_lambo_1.png, race_lambo_2.png");

  // steering check: hold right; wheels should visually turn RIGHT
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "steer_right.png"), clip: { x: 340, y: 380, width: 600, height: 420 } });
  await page.keyboard.up("ArrowRight");
  console.log("shot: steer_right.png");

  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  if (errors.length) console.log("page errors:", errors);
  await browser.close();
  console.log("done");
})().catch(e => { console.error("VISUAL FAIL:", e.message); process.exit(1); });
