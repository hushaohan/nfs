/* debug_streetgt.js — inspect streetgt template children after mount */
"use strict";
const fs = require("fs");
const vm = require("vm");
const THREE = require("../vendor/three.min.js");
global.THREE = THREE;
global.window = { __CAR_MODEL_CACHE__: {}, __CAR_MODEL_REGISTRY__: {} };
global.CAR_SPECS = { streetgt: {
  wheelbase: 2.85, cgFront: 0.49, trackWidth: 1.86, wheelRadius: 0.36,
} };
global.fetch = url => Promise.resolve({ ok: true, arrayBuffer: () => {
  const b = fs.readFileSync(url);
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
} });
const noopEl = () => ({ getContext: () => new Proxy({}, { get: (t,k) => (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => {}, set: () => true }), width: 0, height: 0, style: {} });
global.document = { createElement: noopEl, dispatchEvent() {} };
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });

for (const f of ["js/gltf.js", "js/physics.js", "js/effects.js"]) {
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
}

(async () => {
  await window.__preloadCarModels();
  const tg = window.__CAR_MODEL_REGISTRY__.streetgt.template;
  tg.updateMatrixWorld(true);
  console.log("template children:", tg.children.length);
  tg.children.forEach((ch, i) => {
    ch.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(ch);
    const sz = new THREE.Vector3(); bb.getSize(sz);
    const c = new THREE.Vector3(); bb.getCenter(c);
    const mn = new THREE.Vector3(); bb.getMin
    console.log("child", i, ch.type,
      "mat:", (ch.material && ch.material.name || "?").slice(0, 14),
      "| size:", sz.x.toFixed(2) + "/" + sz.y.toFixed(2) + "/" + sz.z.toFixed(2),
      "| min:", bb.min.x.toFixed(1) + "," + bb.min.y.toFixed(1) + "," + bb.min.z.toFixed(1));
  });
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
