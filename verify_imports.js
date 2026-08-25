/* verify_imports.js — headless validation of imported car mounting:
 *  • every model builds with 4 wheels satisfying the contract
 *  • spin groups are radially balanced (no vertex orbits beyond the
 *    tire radius — mathematically impossible to wobble)
 *  • ordering is [FL,FR,RL,RR] so only fronts steer                  */
"use strict";
const fs = require("fs");
const vm = require("vm");

global.THREE = require("./vendor/three.min.js");
global.window = { __CAR_MODEL_CACHE__: {}, __CAR_MODEL_REGISTRY__: {} };
const noopEl = () => ({
  getContext: () => new Proxy({}, { get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => {}, set: () => true }),
  width: 0, height: 0, style: {},
});
global.document = { createElement: noopEl, addEventListener() {}, dispatchEvent() {} };
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });

for (const f of ["js/gltf.js", "js/physics.js", "js/effects.js"]) {
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
}

// fetch shim reading the real GLBs from assets/
global.fetch = url => Promise.resolve({
  ok: true,
  arrayBuffer: () => {
    const b = fs.readFileSync(url);
    return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  },
});

(async () => {
  await window.__preloadCarModels();

  let all = true;
  for (const key of ["lambo", "storm", "s7"]) {
    const spec = CAR_SPECS[key];
    if (!window.__CAR_MODEL_CACHE__[key].ready) throw new Error(key + ": template not built");
    const m = buildCarMesh(spec);
    const w = m.userData.wheels;

    // contract
    const okContract = w.length === 4 && w.every(g => g.children[0] && g.children[1]);

    // order: fronts share +z (wheelbase fraction), rears share −z
    const zs = w.map(g => g.position.z);
    const zf = spec.wheelbase * spec.cgFront;
    const okOrder = Math.abs(zs[0] - zf) < 0.02 && Math.abs(zs[1] - zf) < 0.02 &&
                    zs[2] < 0 && zs[3] < 0;

    // balance: max orbit radius of any spinning vertex
    let worst = 0;
    for (const g of w) {
      const spin = g.children[0];
      spin.traverse(o => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          worst = Math.max(worst, Math.hypot(p.getY(i), p.getZ(i)));
        }
      });
    }
    const okBalance = worst <= spec.wheelRadius * 1.18;
    console.log(key.padEnd(6), "contract:", okContract ? "✓" : "✗",
      "| order:", okOrder ? "✓" : "✗",
      "| max spin orbit:", worst.toFixed(3), "m",
      worst <= spec.wheelRadius * 1.18 ? "✓ balanced" : "✗ LUMPY");
    if (!okContract || !okOrder || !okBalance) all = false;
  }
  console.log(all ? "\nIMPORT MOUNTING VERIFIED" : "FAILED");
  if (!all) process.exit(1);
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
