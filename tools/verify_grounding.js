/* verify_grounding.js — check body vs wheel positions after grounding fix */
"use strict";
const fs = require("fs");
const vm = require("vm");
const THREE = require("../vendor/three.min.js");
global.THREE = THREE;
global.window = { __CAR_MODEL_CACHE__: {}, __CAR_MODEL_REGISTRY__: {} };
const noopEl = () => ({ getContext: () => new Proxy({}, {
  get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => {},
  set: () => true,
}), width: 0, height: 0, style: {} });
global.document = { createElement: noopEl, dispatchEvent() {} };
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });
global.fetch = url => Promise.resolve({ ok: true, arrayBuffer: () => {
  const b = fs.readFileSync(url);
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}});

for (const f of ["js/gltf.js", "js/physics.js", "js/effects.js"]) {
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
}

(async () => {
  await window.__preloadCarModels();
  for (const key of ["streetgt", "lambo"]) {
    const spec = CAR_SPECS[key];
    const m = buildCarMesh(spec);
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    const bodyBox = new THREE.Box3();
    m.traverse(o => {
      if (!o.isMesh) return;
      let isWheel = false, p = o;
      while (p) { if (p.name && p.name.startsWith("cwm_")) { isWheel = true; break; } p = p.parent; }
      if (!isWheel) { const b = new THREE.Box3().setFromObject(o); bodyBox.union(b); }
    });
    console.log(key.padEnd(10),
      "car bottom:", bb.min.y.toFixed(3),
      "| body bottom:", bodyBox.min.y.toFixed(3),
      "| body top:", bodyBox.max.y.toFixed(3),
      "| wheel R:", spec.wheelRadius.toFixed(2));
  }
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
