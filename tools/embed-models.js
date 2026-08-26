/* tools/embed-models.js — regenerate js/car_models_data.js from the
 * original GLB files. Base64-embeds each model so the game works from
 * file:// AND https identically (fetch can't read file:// URLs).
 *
 *   node tools/embed-models.js
 *
 * Registry keys ↔ files (edit ORDER/FILES when adding new cars):
 *   lambo  storm  s7  gtsport  concept_s
 */
"use strict";
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const FILES = {
  lambo: "assets/cars/lambo_v12_gt.glb",
  storm: "assets/cars/storm_gt.glb",
  s7: "assets/cars/s7_twin.glb",
  gtsport: "assets/cars/gt_sport.glb",
  concept_s: "assets/cars/concept_s.glb",
  streetgt: "assets/cars/street_gt.glb",
};
const ORDER = Object.keys(FILES);

let out = `/* =====================================================================
 * car_models_data.js — GENERATED FILE (tools/embed-models.js).
 * Base64-embedded GLB car models so imports work from file:// and https.
 * Do not edit by hand.                                                */
"use strict";
window.__CAR_MODEL_DATA__ = {
`;

for (const key of ORDER) {
  const file = FILES[key];
  if (!fs.existsSync(file)) { console.error("missing:", file); process.exit(1); }
  const gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
  const b64 = gz.toString("base64");
  out += `  ${key}: { fmt: "gz", b64: "${b64}" },\n`;
  console.log(key.padEnd(10), file, "->", (b64.length / 1048576).toFixed(1), "MB gz+b64");
}

out += "};\n";
const dest = path.join(__dirname, "..", "js", "car_models_data.js");
fs.writeFileSync(dest, out);
console.log("wrote", dest, (fs.statSync(dest).size / 1048576).toFixed(1), "MB total");
