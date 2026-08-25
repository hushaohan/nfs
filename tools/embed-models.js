/* tools/embed-models.js — regenerate js/car_models_data.js from the
 * original GLB files. Base64-embeds each model so the game works from
 * file:// AND https identically (fetch can't read file:// URLs).
 *
 *   node tools/embed-models.js <glb…>      # in CAR_MODEL_REGISTRY order
 *
 * Expected inputs (matching registry keys):
 *   lambo  storm  s7
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ORDER = ["lambo", "storm", "s7"];
const FILES = {
  lambo: "assets/cars/lambo_v12_gt.glb",
  storm: "assets/cars/storm_gt.glb",
  s7: "assets/cars/s7_twin.glb",
};

const args = process.argv.slice(2);
if (args.length) { // explicit mapping by order
  ORDER.forEach((k, i) => { if (args[i]) FILES[k] = args[i]; });
}

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
  const buf = fs.readFileSync(file);
  const b64 = buf.toString("base64");
  out += `  ${key}: "${b64}",\n`;
  console.log(key.padEnd(6), file, "->", (b64.length / 1048576).toFixed(1), "MB base64");
}

out += "};\n";
const dest = path.join(__dirname, "..", "js", "car_models_data.js");
fs.writeFileSync(dest, out);
console.log("wrote", dest, (fs.statSync(dest).size / 1048576).toFixed(1), "MB total");
