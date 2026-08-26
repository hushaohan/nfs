/* verify_gzip_models.js — embedded gzip decode + template build check */
"use strict";
const fs = require("fs");
const vm = require("vm");
const zlib = require("zlib");

global.THREE = require("./vendor/three.min.js");
global.window = { __CAR_MODEL_CACHE__: {}, __CAR_MODEL_REGISTRY__: {} };
const noopEl = () => ({
  getContext: () => new Proxy({}, {
    get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => {},
    set: () => true,
  }),
  width: 0, height: 0, style: {},
});
global.document = { createElement: noopEl, dispatchEvent() {} };
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });
global.atob = s => Buffer.from(s, "base64").toString("binary");
global.Blob = class { constructor(parts) { this._parts = parts; } };
// minimal web-streams shims backed by zlib for Node verification
global.Blob = class {
  constructor(parts) { this._bytes = parts[0]; }
  stream() { return { _bytes: this._bytes, pipeThrough(ds) { ds._src = this; return ds; } }; }
};
global.DecompressionStream = class {
  constructor(fmt) { if (fmt !== "gzip") throw new Error("bad fmt"); }
};
global.Response = class {
  constructor(stream) { this._ds = stream; }
  async arrayBuffer() {
    const raw = this._ds._src._bytes;
    return zlib.gunzipSync(raw).buffer;
  }
};

for (const f of ["js/gltf.js", "js/car_models_data.js", "js/physics.js", "js/effects.js"]) {
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
}

(async () => {
  await window.__preloadCarModels();
  let all = true;
  const specKeys = ["lambo", "storm", "s7", "gtsport", "concept_s"];
  for (const key of specKeys) {
    const st = window.__CAR_MODEL_CACHE__[key];
    const okReady = st.ready === true;
    const m = buildCarMesh(CAR_SPECS[key]);
    const w = m.userData.wheels;
    const okWheels = w.length === 4 && w.every(g => g.children[0] && g.children[1]);
    console.log(key.padEnd(10), "ready:", okReady ? "✓" : "✗",
      "| wheels:", w.length, "| contract:", okWheels ? "✓" : "✗");
    if (!okReady || !okWheels) all = false;
  }
  // raw gunzip sanity for every payload
  for (const key of Object.keys(window.__CAR_MODEL_DATA__)) {
    const raw = Buffer.from(window.__CAR_MODEL_DATA__[key].b64, "base64");
    const inf = zlib.gunzipSync(raw);
    if (inf.slice(0, 4).toString("ascii") !== "glTF") throw new Error(key + ": bad magic");
  }
  console.log(all ? "\nGZIP EMBED PIPELINE VERIFIED" : "FAILED");
  if (!all) process.exit(1);
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
